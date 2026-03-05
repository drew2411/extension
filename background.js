// background.js
import {
    generateKeywordMaps,
    generateUserInstructions,
    classifyWithGroq,
    classifyStrictWithGroq
} from './ai-service.js';

const rickrollUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const TEN_MINUTES_MS = 10 * 60 * 1000;

// --- Helper Functions ---

function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        return "";
    }
}

// Returns true only for YouTube video pages and Reddit post pages
function isContentPageUrl(url) {
    if (!url) return false;
    return url.includes('youtube.com/watch') || url.includes('reddit.com/r/');
}

function urlMatchesStrictRule(url, rule) {
    if (!url || !rule) return false;
    const trimmed = rule.trim();
    if (!trimmed) return false;
    try {
        const current = new URL(url);
        if (/^https?:\/\//i.test(trimmed)) return url.startsWith(trimmed);
        const lowerRule = trimmed.toLowerCase();
        const firstSlash = lowerRule.indexOf('/');
        if (firstSlash === -1) {
            const host = current.hostname.toLowerCase();
            return host === lowerRule || host.endsWith('.' + lowerRule);
        }
        const hostPart = lowerRule.slice(0, firstSlash);
        const pathPart = lowerRule.slice(firstSlash);
        const host = current.hostname.toLowerCase();
        const path = current.pathname;
        return (host === hostPart || host.endsWith('.' + hostPart)) && path.startsWith(pathPart);
    } catch (e) {
        return url.startsWith(trimmed);
    }
}

// --- Content Script Injection ---

function injectContentScript(tabId, url) {
    let file = null;
    if (url.includes("youtube.com/watch")) file = 'youtube.js';
    else if (url.includes("reddit.com/r/")) file = 'reddit.js';

    if (file) {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: [file]
        }).catch(err => {
            if (!err.message.includes("Cannot create a new script context")) {
                console.error(`Injection failed for ${file}:`, err);
            }
        });
    }
}

// --- Blocking Logic ---

async function handleBlockAction(tabId) {
    const { blockAction, blockingMode } = await chrome.storage.local.get(['blockAction', 'blockingMode']);
    const action = blockAction || (blockingMode === 'STRICT' ? 'RICKROLL' : 'GREYSCALE');
    try {
        if (action === 'RICKROLL') {
            await chrome.tabs.update(tabId, { url: rickrollUrl });
        } else {
            await chrome.scripting.insertCSS({
                target: { tabId: tabId },
                css: "html { filter: grayscale(100%) !important; pointer-events: none !important; }"
            });
        }
    } catch (e) {
        // Tab may have been closed or we lack permission — ignore gracefully
    }
}

// --- Event-Driven Time Tracking ---

// Tracks the currently active browsing session (for general time history / reports)
let activeSession = null; // { tabId, url, domain, startTime }

function startSession(tabId, url) {
    stopSession(); // flush any previous session first
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url === rickrollUrl) return;
    const domain = getDomain(url);
    if (!domain) return;
    activeSession = { tabId, url, domain, startTime: Date.now() };
}

async function stopSession() {
    if (!activeSession) return;
    const elapsed = Math.round((Date.now() - activeSession.startTime) / 1000);
    if (elapsed > 0) {
        await recordTime(activeSession.domain, elapsed, activeSession.url, activeSession.tabId);
    }
    activeSession = null;
}

// --- Unproductive Time Timer ---
// Only tracks time on YouTube/Reddit content classified as entertainment
let unproductiveSession = null; // { tabId, source ('youtube'|'reddit'), startTime }

function startUnproductiveTimer(tabId, source) {
    pauseUnproductiveTimer(); // flush any previous
    unproductiveSession = { tabId, source, startTime: Date.now() };
}

async function pauseUnproductiveTimer() {
    if (!unproductiveSession) return;
    const elapsed = Math.round((Date.now() - unproductiveSession.startTime) / 1000);
    if (elapsed > 0) {
        await recordUnproductiveTime(unproductiveSession.source, elapsed, unproductiveSession.tabId);
    }
    unproductiveSession = null;
}

async function recordUnproductiveTime(source, seconds, tabId) {
    const todayStr = new Date().toISOString().split('T')[0];
    const data = await chrome.storage.local.get(['unproductiveTimers', 'lastResetDate']);
    const timers = data.unproductiveTimers || {
        youtube: { limitMinutes: -1, secondsUsedToday: 0 },
        reddit: { limitMinutes: -1, secondsUsedToday: 0 }
    };

    // Daily reset
    if (data.lastResetDate !== todayStr) {
        timers.youtube.secondsUsedToday = 0;
        timers.reddit.secondsUsedToday = 0;
    }

    if (timers[source]) {
        timers[source].secondsUsedToday += seconds;
        await chrome.storage.local.set({ unproductiveTimers: timers });

        // Check if limit exceeded
        const limit = timers[source].limitMinutes;
        if (limit >= 0 && timers[source].secondsUsedToday >= limit * 60) {
            if (tabId) handleBlockAction(tabId);
        }
    }
}

// Record time into storage: both time history (reports) and limit counters
async function recordTime(domain, seconds, url, tabId) {
    const todayStr = new Date().toISOString().split('T')[0];
    const data = await chrome.storage.local.get([
        'youtubeLimit', 'redditLimit', 'strictUrlBlocklist',
        'timeHistory', 'lastResetDate'
    ]);

    // Daily reset (also resets unproductive timers — those are handled in recordUnproductiveTime)
    if (data.lastResetDate !== todayStr) {
        if (data.youtubeLimit) data.youtubeLimit.secondsUsedToday = 0;
        if (data.redditLimit) data.redditLimit.secondsUsedToday = 0;
        if (Array.isArray(data.strictUrlBlocklist)) {
            data.strictUrlBlocklist.forEach(u => u.secondsUsedToday = 0);
        }
        data.lastResetDate = todayStr;
    }

    // --- Determine if this domain should be tracked ---
    // For YouTube/Reddit: only track if the tab's content was classified as unproductive
    const isYouTube = domain === 'www.youtube.com' || domain === 'youtube.com';
    const isReddit = domain === 'www.reddit.com' || domain === 'reddit.com';
    let shouldTrack = true;

    if ((isYouTube || isReddit) && tabId) {
        // Check if this tab was classified as entertainment
        const sessionData = await chrome.storage.session.get(tabId.toString());
        const classification = sessionData[tabId];
        // Only track time if classified as entertainment, or if on homepage (always tracked)
        const isHomepage = (isYouTube && (url === 'https://www.youtube.com/' || url === 'https://www.youtube.com'))
            || (isReddit && (url === 'https://www.reddit.com/' || url === 'https://www.reddit.com'));
        if (!isHomepage && (!classification || classification.entertainment !== true)) {
            shouldTrack = false; // Productive content on YT/Reddit — don't track
        }
    }

    // --- Update time history (always, for reports — shows all browsing) ---
    const history = data.timeHistory || {};
    if (!history[todayStr]) history[todayStr] = {};
    history[todayStr][domain] = (history[todayStr][domain] || 0) + seconds;

    // Purge entries older than 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const dateKey of Object.keys(history)) {
        if (dateKey < cutoffStr) delete history[dateKey];
    }

    const storageUpdate = { timeHistory: history, lastResetDate: todayStr };

    // --- Update limit counters (only if this domain should be tracked) ---
    if (shouldTrack) {
        // YouTube homepage limit
        const isYoutubeHome = url === 'https://www.youtube.com/' || url === 'https://www.youtube.com';
        if (isYoutubeHome && data.youtubeLimit) {
            data.youtubeLimit.secondsUsedToday += seconds;
            storageUpdate.youtubeLimit = data.youtubeLimit;
            if (data.youtubeLimit.limitMinutes === 0 ||
                (data.youtubeLimit.limitMinutes > 0 && data.youtubeLimit.secondsUsedToday >= data.youtubeLimit.limitMinutes * 60)) {
                if (tabId) handleBlockAction(tabId);
            }
        }

        // Reddit homepage limit
        const isRedditHome = url === 'https://www.reddit.com/' || url === 'https://www.reddit.com';
        if (isRedditHome && data.redditLimit) {
            data.redditLimit.secondsUsedToday += seconds;
            storageUpdate.redditLimit = data.redditLimit;
            if (data.redditLimit.limitMinutes === 0 ||
                (data.redditLimit.limitMinutes > 0 && data.redditLimit.secondsUsedToday >= data.redditLimit.limitMinutes * 60)) {
                if (tabId) handleBlockAction(tabId);
            }
        }

        // Strict URL blocklist limits
        if (Array.isArray(data.strictUrlBlocklist)) {
            for (const item of data.strictUrlBlocklist) {
                if (urlMatchesStrictRule(url, item.url)) {
                    item.secondsUsedToday += seconds;
                    if (item.limitMinutes === 0 ||
                        (item.limitMinutes > 0 && item.secondsUsedToday >= item.limitMinutes * 60)) {
                        if (tabId) handleBlockAction(tabId);
                    }
                }
            }
            storageUpdate.strictUrlBlocklist = data.strictUrlBlocklist;
        }
    }

    await chrome.storage.local.set(storageUpdate);
}

// --- Tab & Window Event Listeners for Time Tracking ---

// When user switches tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await stopSession();
    await pauseUnproductiveTimer();
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            startSession(tab.id, tab.url);
            // Resume unproductive timer if returning to an unproductive tab
            await maybeResumeUnproductiveTimer(tab.id, tab.url);
        }
    } catch (e) { /* tab may have closed */ }
});

// When browser window focus changes (alt-tab away, minimize, etc.)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        await stopSession();
        await pauseUnproductiveTimer();
    } else {
        try {
            const [tab] = await chrome.tabs.query({ active: true, windowId });
            if (tab && tab.url) {
                startSession(tab.id, tab.url);
                await maybeResumeUnproductiveTimer(tab.id, tab.url);
            }
        } catch (e) { /* window may have closed */ }
    }
});

// Safety flush alarm — handles long sessions and keeps service worker alive
chrome.alarms.create('timeTracker', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'timeTracker') return;
    // Flush general session
    if (activeSession) {
        const { tabId, url } = activeSession;
        await stopSession();
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.active) startSession(tabId, tab.url || url);
        } catch (e) { /* tab may have closed */ }
    }
    // Flush unproductive timer
    if (unproductiveSession) {
        const { tabId, source } = unproductiveSession;
        await pauseUnproductiveTimer();
        try {
            const tab = await chrome.tabs.get(tabId);
            // Only restart if tab is active AND still on a content page (video/post)
            if (tab && tab.active && isContentPageUrl(tab.url)) {
                const sessionData = await chrome.storage.session.get(tabId.toString());
                const classification = sessionData[tabId];
                if (classification && classification.entertainment === true) {
                    startUnproductiveTimer(tabId, source);
                }
            }
        } catch (e) { /* tab may have closed */ }
    }
});

// Helper: resume unproductive timer if returning to a tab with entertainment classification
async function maybeResumeUnproductiveTimer(tabId, url) {
    // Only resume if the URL is actually a video/post page
    if (!isContentPageUrl(url)) return;

    const domain = getDomain(url);
    const isYouTube = domain === 'www.youtube.com' || domain === 'youtube.com';
    const isReddit = domain === 'www.reddit.com' || domain === 'reddit.com';
    if (!isYouTube && !isReddit) return;

    const sessionData = await chrome.storage.session.get(tabId.toString());
    const classification = sessionData[tabId];
    if (classification && classification.entertainment === true) {
        const source = isYouTube ? 'youtube' : 'reddit';
        // Check limit first
        const data = await chrome.storage.local.get(['unproductiveTimers']);
        const timers = data.unproductiveTimers || {};
        const timer = timers[source];
        if (timer && timer.limitMinutes >= 0 && timer.secondsUsedToday >= timer.limitMinutes * 60) {
            handleBlockAction(tabId);
        } else {
            startUnproductiveTimer(tabId, source);
        }
    }
}

// When a tab's URL changes (navigation within same tab) — handles timer, unproductive timer, blocking, injection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Timer: flush old session on URL change in active tab
    if (activeSession && activeSession.tabId === tabId && changeInfo.url) {
        stopSession().then(() => {
            if (changeInfo.url !== rickrollUrl) {
                startSession(tabId, changeInfo.url);
            }
        });
    }
    // Unproductive timer: pause on URL change (video changed / navigated away)
    if (unproductiveSession && unproductiveSession.tabId === tabId && changeInfo.url) {
        pauseUnproductiveTimer();
    }

    // Blocking & injection: only on full page load
    if (changeInfo.status !== 'complete' || !tab.url || tab.url === rickrollUrl) return;

    const url = tab.url;
    chrome.storage.local.get(['youtubeLimit', 'redditLimit', 'strictUrlBlocklist', 'exactUrlBlocklist'], (res) => {
        const isYoutubeHome = url === 'https://www.youtube.com/' || url === 'https://www.youtube.com';
        const isRedditHome = url === 'https://www.reddit.com/' || url === 'https://www.reddit.com';

        if (isYoutubeHome && res.youtubeLimit) {
            if (res.youtubeLimit.limitMinutes === 0 || (res.youtubeLimit.limitMinutes > 0 && res.youtubeLimit.secondsUsedToday >= res.youtubeLimit.limitMinutes * 60)) {
                return handleBlockAction(tabId);
            }
        }

        if (isRedditHome && res.redditLimit) {
            if (res.redditLimit.limitMinutes === 0 || (res.redditLimit.limitMinutes > 0 && res.redditLimit.secondsUsedToday >= res.redditLimit.limitMinutes * 60)) {
                return handleBlockAction(tabId);
            }
        }

        const strictEntry = (res.strictUrlBlocklist || []).find(item => urlMatchesStrictRule(url, item.url));
        if (strictEntry) {
            if (strictEntry.limitMinutes === 0 || (strictEntry.limitMinutes > 0 && strictEntry.secondsUsedToday >= strictEntry.limitMinutes * 60)) {
                return handleBlockAction(tabId);
            }
        }

        if ((res.exactUrlBlocklist || []).includes(url)) {
            return handleBlockAction(tabId);
        }

        injectContentScript(tabId, url);
    });
});

chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
    if (details.url && details.url !== rickrollUrl) {
        // SPA navigation (YouTube/Reddit) — pause unproductive timer since the page content changed
        if (unproductiveSession && unproductiveSession.tabId === details.tabId) {
            await pauseUnproductiveTimer();
        }
        // Also flush and restart the general session for accurate time tracking
        if (activeSession && activeSession.tabId === details.tabId) {
            await stopSession();
            startSession(details.tabId, details.url);
        }
        injectContentScript(details.tabId, details.url);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'contentData') {
        handleContentData(message.data, sender.tab.id);
        sendResponse({ success: true });
    } else if (message.type === 'generateKeywordMaps') {
        generateKeywordMaps(message.userBio, message.groqApiKey).then(maps => {
            if (maps) chrome.storage.local.set({ keywordMaps: maps });
            sendResponse({ success: !!maps });
        });
    } else if (message.type === 'generateInstructions') {
        generateUserInstructions(message.userBio, message.groqApiKey).then(instr => {
            if (instr) chrome.storage.local.set({ userInstructions: instr });
            sendResponse({ success: !!instr });
        });
    } else if (message.type === 'removeFromBlocklist') {
        removeFromBlocklist(message.key).then(() => sendResponse({ success: true }));
    } else if (message.type === 'getClassification') {
        chrome.storage.session.get(message.tabId.toString(), res => sendResponse(res[message.tabId]));
    }
    return true;
});

async function handleContentData(data, tabId) {
    const { source, channel, subreddit } = data;
    const blockKey = source === 'youtube' ? channel : subreddit;

    chrome.storage.session.set({ [tabId]: { status: 'classifying', key: blockKey, timestamp: Date.now() } });

    const { blocklist, tempWhitelist, blockingMode, groqApiKey, productiveContent, unwantedContent, userInstructions, unproductiveTimers } =
        await chrome.storage.local.get(['blocklist', 'tempWhitelist', 'blockingMode', 'groqApiKey', 'productiveContent', 'unwantedContent', 'userInstructions', 'unproductiveTimers']);

    if (tempWhitelist?.[blockKey] && (Date.now() - tempWhitelist[blockKey].timestamp < TEN_MINUTES_MS)) {
        return chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: "Manually unblocked", key: blockKey, timestamp: Date.now() } });
    }

    if (blocklist?.includes(blockKey)) {
        return await blockAndRedirect(tabId, blockKey, "This content is on your blocklist.");
    }

    const heuristic = await analyzeWithKeywords(data);
    if (heuristic.decision === 'allow') {
        return chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: heuristic.reason, key: blockKey, timestamp: Date.now() } });
    } else if (heuristic.decision === 'block') {
        return await handleUnproductiveClassification(tabId, blockKey, heuristic.reason, source, unproductiveTimers);
    }

    if (blockingMode === 'STRICT') {
        const res = await classifyStrictWithGroq(data, groqApiKey, productiveContent);
        if (res && res.productive_match) {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: res.reasoning, key: blockKey, timestamp: Date.now() } });
        } else {
            await handleUnproductiveClassification(tabId, blockKey, res?.reasoning || "Strict mode: No productive match found.", source, unproductiveTimers);
        }
    } else {
        const res = await classifyWithGroq(data, groqApiKey, productiveContent, unwantedContent, userInstructions);
        if (res && res.entertainment) {
            await handleUnproductiveClassification(tabId, blockKey, res.reasoning, source, unproductiveTimers);
        } else {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: res?.reasoning || "Lenient mode: Allowed", key: blockKey, timestamp: Date.now() } });
        }
    }
}

// Called when content is classified as unproductive — either blocks immediately or starts timer
async function handleUnproductiveClassification(tabId, blockKey, reasoning, source, unproductiveTimers) {
    const timers = unproductiveTimers || {};
    const timer = timers[source];

    // If no timer is set (limitMinutes is -1 or missing), block immediately as before
    if (!timer || timer.limitMinutes < 0) {
        return await blockAndRedirect(tabId, blockKey, reasoning);
    }

    // If limit is 0, block immediately (no unproductive time allowed)
    if (timer.limitMinutes === 0) {
        return await blockAndRedirect(tabId, blockKey, "Unproductive time limit: 0 minutes allowed.");
    }

    // If limit already exceeded, block
    if (timer.secondsUsedToday >= timer.limitMinutes * 60) {
        return await blockAndRedirect(tabId, blockKey, `Daily unproductive time limit (${timer.limitMinutes}m) exceeded.`);
    }

    // Limit not yet exceeded — allow but start the unproductive timer
    chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning, key: blockKey, timestamp: Date.now() } });
    startUnproductiveTimer(tabId, source);
}

async function blockAndRedirect(tabId, key, reasoning) {
    await addToBlocklist(key);
    chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning, key, timestamp: Date.now() } });
    handleBlockAction(tabId);
}

// --- Browser Events & Storage Helpers ---
async function getBlocklist() {
    const res = await chrome.storage.local.get({ blocklist: [] });
    return res.blocklist;
}

async function addToBlocklist(key) {
    const blocklist = await getBlocklist();
    if (!blocklist.includes(key)) {
        blocklist.push(key);
        await chrome.storage.local.set({ blocklist });
    }
}

async function removeFromBlocklist(key) {
    let blocklist = await getBlocklist();
    blocklist = blocklist.filter(item => item !== key);
    await chrome.storage.local.set({ blocklist });
    const { tempWhitelist = {} } = await chrome.storage.local.get('tempWhitelist');
    tempWhitelist[key] = { timestamp: Date.now() };
    await chrome.storage.local.set({ tempWhitelist });
}

// --- Heuristic Analysis ---
async function analyzeWithKeywords(data) {
    const { keywordMaps, heuristicDominanceRatio } = await chrome.storage.local.get(['keywordMaps', 'heuristicDominanceRatio']);
    if (!keywordMaps) return { decision: 'unknown', reason: 'No keyword maps' };

    const dominance = typeof heuristicDominanceRatio === 'number' && heuristicDominanceRatio >= 1 ? heuristicDominanceRatio : 2.0;
    const fields = [data.title, data.description, data.content, data.channel, data.subreddit];
    if (Array.isArray(data.comments)) fields.push(data.comments.join('\n'));
    const text = fields.filter(Boolean).join('\n').toLowerCase();

    if (!text) return { decision: 'unknown', reason: 'No text' };

    const flatten = (map) => Object.values(map || {}).flat();
    const productiveKw = new Set(flatten(keywordMaps.productive));
    const unwantedKw = new Set(flatten(keywordMaps.unwanted));

    const countMatches = (kwSet) => {
        let count = 0;
        kwSet.forEach(kw => {
            if (!kw) return;
            const pattern = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'gi');
            const matches = text.match(pattern);
            if (matches) count += matches.length;
        });
        return count;
    };

    const prodHits = countMatches(productiveKw);
    const unwnHits = countMatches(unwantedKw);
    const totalHits = prodHits + unwnHits;

    if (totalHits < 3) return { decision: 'unknown', reason: `Hits < 3` };
    const ratio = unwnHits / Math.max(1, prodHits);
    if (unwnHits >= 3 && ratio >= dominance) return { decision: 'block', reason: `Unwanted ratio ${ratio.toFixed(2)}` };
    const invRatio = prodHits / Math.max(1, unwnHits);
    if (prodHits >= 3 && invRatio >= dominance) return { decision: 'allow', reason: `Productive ratio ${invRatio.toFixed(2)}` };

    return { decision: 'unknown', reason: `Inconclusive ratio` };
}
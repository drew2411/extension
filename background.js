// background.js
import {
    classifyWithGroq,
    classifyStrictWithGroq,
    evaluateIntentClarification,
    generateIntentKeywords,
    analyzeDiscoveryBuffer
} from './ai-service.js';

const rickrollUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const TEN_MINUTES_MS = 10 * 60 * 1000;
const MAX_DISCOVERY_BUFFER = 50;

// Rickroll loop guard: tabId -> timestamp
const recentlyBlockedTabs = new Map();

// --- Helpers ---
function getDomain(url) {
    try { return new URL(url).hostname; } catch (e) { return ""; }
}

function getPageSourceType(url) {
    if (!url) return null;
    if (url.includes('youtube.com/watch')) return 'youtube';
    if (url.includes('reddit.com/r/')) return 'reddit';
    if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
    if (url === rickrollUrl) return null;

    const domain = getDomain(url);
    if (domain.includes('youtube.com') || domain.includes('reddit.com')) return null;

    return 'web';
}

function isContentPageUrl(url) {
    return getPageSourceType(url) !== null;
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
        return (host === hostPart || host.endsWith('.' + hostPart)) && current.pathname.startsWith(pathPart);
    } catch (e) { return url.startsWith(trimmed); }
}

function urlMatchesHomepageRule(url, ruleDomain) {
    if (!url || !ruleDomain) return false;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const rule = ruleDomain.trim().toLowerCase();
        
        const isDomainMatch = host === rule || host.endsWith('.' + rule);
        if (!isDomainMatch) return false;
        
        return parsed.pathname === '/' || parsed.pathname === '';
    } catch (e) { return false; }
}

// --- Daily Reset ---
async function checkAndResetDaily() {
    const todayStr = new Date().toISOString().split('T')[0];
    const data = await chrome.storage.local.get([
        'lastResetDate', 'homepageBlocklist', 'unproductiveTimers', 'strictUrlBlocklist', 'youtubeLimit', 'redditLimit'
    ]);
    if (data.lastResetDate === todayStr) return;
    const update = { lastResetDate: todayStr };
    
    if (Array.isArray(data.homepageBlocklist)) {
        data.homepageBlocklist.forEach(u => { u.secondsUsedToday = 0; });
        update.homepageBlocklist = data.homepageBlocklist;
    }
    if (data.youtubeLimit)  { data.youtubeLimit.secondsUsedToday = 0;  update.youtubeLimit = data.youtubeLimit; }
    if (data.redditLimit)   { data.redditLimit.secondsUsedToday = 0;   update.redditLimit  = data.redditLimit;  }
    
    if (data.unproductiveTimers) {
        Object.values(data.unproductiveTimers).forEach(t => { t.secondsUsedToday = 0; });
        update.unproductiveTimers = data.unproductiveTimers;
    }
    if (Array.isArray(data.strictUrlBlocklist)) {
        data.strictUrlBlocklist.forEach(u => { u.secondsUsedToday = 0; });
        update.strictUrlBlocklist = data.strictUrlBlocklist;
    }
    await chrome.storage.local.set(update);
}

// --- Content Script Injection ---
function injectContentScript(tabId, url) {
    const sourceType = getPageSourceType(url);
    if (!sourceType) return;

    chrome.storage.local.get(['useMozillaForYoutube', 'useMozillaForReddit'], (res) => {
        const useMozillaForYoutube = !!res.useMozillaForYoutube;
        const useMozillaForReddit = !!res.useMozillaForReddit;

        if (sourceType === 'youtube' && !useMozillaForYoutube) {
            chrome.scripting.executeScript({ target: { tabId }, files: ['youtube.js'] })
                .catch(err => { if (!err.message.includes("Cannot create a new script context")) console.error("Injection failed for youtube.js:", err); });
        } else if (sourceType === 'reddit' && !useMozillaForReddit) {
            chrome.scripting.executeScript({ target: { tabId }, files: ['reddit.js'] })
                .catch(err => { if (!err.message.includes("Cannot create a new script context")) console.error("Injection failed for reddit.js:", err); });
        } else {
            chrome.scripting.executeScript({ target: { tabId }, files: ['Readability.js', 'readability-extractor.js'] })
                .catch(err => { if (!err.message.includes("Cannot create a new script context")) console.error("Injection failed for readability:", err); });
        }
    });
}

// --- Block Action ---
async function handleBlockAction(tabId) {
    const { blockAction, blockingMode } = await chrome.storage.local.get(['blockAction', 'blockingMode']);
    const action = blockAction || (blockingMode === 'STRICT' ? 'RICKROLL' : 'GREYSCALE');
    recentlyBlockedTabs.set(tabId, Date.now());
    try {
        if (action === 'RICKROLL') {
            await chrome.tabs.update(tabId, { url: rickrollUrl });
        } else {
            await chrome.scripting.insertCSS({
                target: { tabId },
                css: "html { filter: grayscale(100%) !important; pointer-events: none !important; }"
            });
        }
    } catch (e) { /* tab closed or no permission */ }
}

// --- General Session Tracking ---
let activeSession = null;

function startSession(tabId, url) {
    stopSession();
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url === rickrollUrl) return;
    const domain = getDomain(url);
    if (!domain) return;
    activeSession = { tabId, url, domain, startTime: Date.now() };
}

async function stopSession() {
    if (!activeSession) return;
    const elapsed = Math.round((Date.now() - activeSession.startTime) / 1000);
    if (elapsed > 0) await recordTime(activeSession.domain, elapsed, activeSession.url, activeSession.tabId);
    activeSession = null;
}

// --- Unproductive Content Timer ---
let unproductiveSession = null;

function startUnproductiveTimer(tabId, source) {
    pauseUnproductiveTimer();
    unproductiveSession = { tabId, source, startTime: Date.now() };
}

async function pauseUnproductiveTimer() {
    if (!unproductiveSession) return;
    const elapsed = Math.round((Date.now() - unproductiveSession.startTime) / 1000);
    if (elapsed > 0) await recordUnproductiveTime(unproductiveSession.source, elapsed, unproductiveSession.tabId);
    unproductiveSession = null;
}

async function recordUnproductiveTime(source, seconds, tabId) {
    const data = await chrome.storage.local.get(['unproductiveTimers']);
    const timers = data.unproductiveTimers || {
        overall: { id: 'overall', name: 'Overall Limit', domains: [], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0, isOverall: true },
        youtube: { id: 'youtube', name: 'YouTube', domains: ['youtube.com', 'youtu.be'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
        reddit:  { id: 'reddit', name: 'Reddit', domains: ['reddit.com'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
        web:     { id: 'web', name: 'Other Websites', domains: ['*'], excludedDomains: ['youtube.com', 'youtu.be', 'reddit.com'], limitMinutes: -1, secondsUsedToday: 0 }
    };
    
    if (!timers.overall) {
        timers.overall = { id: 'overall', name: 'Overall Limit', domains: [], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0, isOverall: true };
    }
    
    if (source && timers[source]) {
        timers[source].secondsUsedToday += seconds;
    }
    
    // Calculate overall time as the sum of all specific timers (excluding overall itself)
    let totalSum = 0;
    for (const key of Object.keys(timers)) {
        if (key !== 'overall' && timers[key]) {
            totalSum += timers[key].secondsUsedToday;
        }
    }
    timers.overall.secondsUsedToday = totalSum;
    
    await chrome.storage.local.set({ unproductiveTimers: timers });
    
    // Check specific timer limit
    if (source && timers[source]) {
        const limit = timers[source].limitMinutes;
        if (limit > 0 && timers[source].secondsUsedToday >= limit * 60) {
            if (tabId) handleBlockAction(tabId);
            return;
        }
    }
    
    // Check overall timer limit
    const overallLimit = timers.overall.limitMinutes;
    if (overallLimit > 0 && timers.overall.secondsUsedToday >= overallLimit * 60) {
        if (tabId) handleBlockAction(tabId);
    }
}

async function recordTime(domain, seconds, url, tabId) {
    const todayStr = new Date().toISOString().split('T')[0];
    const data = await chrome.storage.local.get(['homepageBlocklist', 'strictUrlBlocklist', 'timeHistory', 'lastResetDate', 'youtubeLimit', 'redditLimit']);

    // Time history
    const history = data.timeHistory || {};
    if (!history[todayStr]) history[todayStr] = {};
    history[todayStr][domain] = (history[todayStr][domain] || 0) + seconds;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const k of Object.keys(history)) { if (k < cutoffStr) delete history[k]; }

    const storageUpdate = { timeHistory: history, lastResetDate: todayStr };

    // Dynamic Homepage Blocklist timers
    if (Array.isArray(data.homepageBlocklist)) {
        for (const item of data.homepageBlocklist) {
            if (urlMatchesHomepageRule(url, item.domain) && item.limitMinutes >= 0) {
                item.secondsUsedToday += seconds;
                if (item.limitMinutes === 0 || item.secondsUsedToday >= item.limitMinutes * 60) {
                    if (tabId) handleBlockAction(tabId);
                }
            }
        }
        storageUpdate.homepageBlocklist = data.homepageBlocklist;
    }

    // Deprecated YouTube homepage timer fallback
    const isYoutubeHome = url === 'https://www.youtube.com/' || url === 'https://www.youtube.com';
    if (isYoutubeHome && data.youtubeLimit && data.youtubeLimit.limitMinutes >= 0) {
        data.youtubeLimit.secondsUsedToday += seconds;
        storageUpdate.youtubeLimit = data.youtubeLimit;
        if (data.youtubeLimit.limitMinutes === 0 || data.youtubeLimit.secondsUsedToday >= data.youtubeLimit.limitMinutes * 60) {
            if (tabId) handleBlockAction(tabId);
        }
    }

    // Deprecated Reddit homepage timer fallback
    const isRedditHome = url === 'https://www.reddit.com/' || url === 'https://www.reddit.com';
    if (isRedditHome && data.redditLimit && data.redditLimit.limitMinutes >= 0) {
        data.redditLimit.secondsUsedToday += seconds;
        storageUpdate.redditLimit = data.redditLimit;
        if (data.redditLimit.limitMinutes === 0 || data.redditLimit.secondsUsedToday >= data.redditLimit.limitMinutes * 60) {
            if (tabId) handleBlockAction(tabId);
        }
    }

    // Strict URL blocklist timers
    if (Array.isArray(data.strictUrlBlocklist)) {
        for (const item of data.strictUrlBlocklist) {
            if (urlMatchesStrictRule(url, item.url) && item.limitMinutes >= 0) {
                item.secondsUsedToday += seconds;
                if (item.limitMinutes === 0 || item.secondsUsedToday >= item.limitMinutes * 60) {
                    if (tabId) handleBlockAction(tabId);
                }
            }
        }
        storageUpdate.strictUrlBlocklist = data.strictUrlBlocklist;
    }

    await chrome.storage.local.set(storageUpdate);
}

// --- Tab / Window Events ---
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await stopSession();
    await pauseUnproductiveTimer();
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            startSession(tab.id, tab.url);
            await maybeResumeUnproductiveTimer(tab.id, tab.url);
        }
    } catch (e) { }
});

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
        } catch (e) { }
    }
});

chrome.alarms.create('timeTracker', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'timeTracker') return;
    await checkAndResetDaily();

    if (activeSession) {
        const { tabId, url } = activeSession;
        await stopSession();
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.active) startSession(tabId, tab.url || url);
        } catch (e) { }
    }
    if (unproductiveSession) {
        const { tabId, source } = unproductiveSession;
        await pauseUnproductiveTimer();
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.active && isContentPageUrl(tab.url)) {
                const sessionData = await chrome.storage.session.get(tabId.toString());
                const cls = sessionData[tabId];
                if (cls && cls.entertainment === true) startUnproductiveTimer(tabId, source);
            }
        } catch (e) { }
    }

    // Clean stale rickroll guards
    const now = Date.now();
    for (const [id, ts] of recentlyBlockedTabs) { if (now - ts > 10000) recentlyBlockedTabs.delete(id); }
});

async function maybeResumeUnproductiveTimer(tabId, url) {
    const domain = getDomain(url);
    if (!domain) return;

    const sessionData = await chrome.storage.session.get(tabId.toString());
    const cls = sessionData[tabId];
    if (!cls || cls.entertainment !== true) return;

    const { unproductiveTimers } = await chrome.storage.local.get(['unproductiveTimers']);
    const timers = unproductiveTimers || {};
    const timerId = findTimerForDomain(domain, timers);
    
    // Check overall limit
    const overall = timers.overall;
    if (overall && overall.limitMinutes > 0 && overall.secondsUsedToday >= overall.limitMinutes * 60) {
        handleBlockAction(tabId);
        return;
    }

    if (!timerId) return;

    const timer = timers[timerId];
    if (timer && timer.limitMinutes > 0 && timer.secondsUsedToday >= timer.limitMinutes * 60) {
        handleBlockAction(tabId);
    } else {
        startUnproductiveTimer(tabId, timerId);
    }
}

// --- URL Updated ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (activeSession && activeSession.tabId === tabId && changeInfo.url) {
        stopSession().then(() => { if (changeInfo.url !== rickrollUrl) startSession(tabId, changeInfo.url); });
    }
    if (unproductiveSession && unproductiveSession.tabId === tabId && changeInfo.url) {
        pauseUnproductiveTimer();
    }
    if (changeInfo.status !== 'complete' || !tab.url || tab.url === rickrollUrl) return;

    // Rickroll guard: skip re-blocking within 5s of a block
    const lastBlock = recentlyBlockedTabs.get(tabId);
    if (lastBlock && Date.now() - lastBlock < 5000) return;

    await checkAndResetDaily();

    const url = tab.url;
    chrome.storage.local.get(['homepageBlocklist', 'strictUrlBlocklist', 'exactUrlBlocklist', 'youtubeLimit', 'redditLimit'], (res) => {
        // Dynamic Homepage Blocklist checks
        if (Array.isArray(res.homepageBlocklist)) {
            const homeEntry = res.homepageBlocklist.find(item => urlMatchesHomepageRule(url, item.domain));
            if (homeEntry && homeEntry.limitMinutes >= 0) {
                if (homeEntry.limitMinutes === 0 || homeEntry.secondsUsedToday >= homeEntry.limitMinutes * 60) {
                    return handleBlockAction(tabId);
                }
            }
        }

        // Deprecated fallback checks
        const isYoutubeHome = url === 'https://www.youtube.com/' || url === 'https://www.youtube.com';
        const isRedditHome  = url === 'https://www.reddit.com/'  || url === 'https://www.reddit.com';

        if (isYoutubeHome && res.youtubeLimit && res.youtubeLimit.limitMinutes >= 0) {
            if (res.youtubeLimit.limitMinutes === 0 || res.youtubeLimit.secondsUsedToday >= res.youtubeLimit.limitMinutes * 60) {
                return handleBlockAction(tabId);
            }
        }
        if (isRedditHome && res.redditLimit && res.redditLimit.limitMinutes >= 0) {
            if (res.redditLimit.limitMinutes === 0 || res.redditLimit.secondsUsedToday >= res.redditLimit.limitMinutes * 60) {
                return handleBlockAction(tabId);
            }
        }

        const strictEntry = (res.strictUrlBlocklist || []).find(item => urlMatchesStrictRule(url, item.url));
        if (strictEntry && strictEntry.limitMinutes >= 0) {
            if (strictEntry.limitMinutes === 0 || strictEntry.secondsUsedToday >= strictEntry.limitMinutes * 60) {
                return handleBlockAction(tabId);
            }
        }
        if ((res.exactUrlBlocklist || []).includes(url)) return handleBlockAction(tabId);

        injectContentScript(tabId, url);
    });
});

chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
    if (!details.url || details.url === rickrollUrl) return;
    if (unproductiveSession && unproductiveSession.tabId === details.tabId) await pauseUnproductiveTimer();
    if (activeSession && activeSession.tabId === details.tabId) {
        await stopSession();
        startSession(details.tabId, details.url);
    }
    injectContentScript(details.tabId, details.url);
});

// --- Messages ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'contentData') {
        handleContentData(message.data, sender.tab.id);
        sendResponse({ success: true });
    } else if (message.type === 'generateKeywordMaps') {
        // Legacy: no-op (keywords now live on intents)
        sendResponse({ success: true });
    } else if (message.type === 'evaluateIntentClarification') {
        chrome.storage.local.get(['groqApiKey'], async ({ groqApiKey }) => {
            const result = await evaluateIntentClarification(message.phrase, groqApiKey, message.personaContext, message.category);
            sendResponse(result);
        });
        return true;
    } else if (message.type === 'generateIntentKeywords') {
        chrome.storage.local.get(['groqApiKey'], async ({ groqApiKey }) => {
            const result = await generateIntentKeywords(message.phrase, message.clarification, message.category, groqApiKey, message.assumedIdentity, message.personaContext || '');
            if (result === null) sendResponse(null);
            else sendResponse(result);
        });
        return true;
    } else if (message.type === 'intentToggled') {
        handleIntentToggled(message.intentId).then(() => sendResponse({ success: true }));
        return true;
    } else if (message.type === 'removeFromBlocklist') {
        removeFromBlocklist(message.key).then(() => sendResponse({ success: true }));
        return true;
    } else if (message.type === 'getClassification') {
        chrome.storage.session.get(message.tabId.toString(), res => sendResponse(res[message.tabId]));
        return true;
    }
    return true;
});

// --- Intent Toggled: scan shadow list and unblock ---
async function handleIntentToggled(intentId) {
    const { shadow_list = [], blocklist = [] } = await chrome.storage.local.get(['shadow_list', 'blocklist']);
    const toUnblock = shadow_list.filter(e => e.blocked_by_intent === intentId).map(e => e.url_id);
    if (toUnblock.length === 0) return;
    const newBlocklist = blocklist.filter(k => !toUnblock.includes(k));
    const newShadowList = shadow_list.filter(e => e.blocked_by_intent !== intentId);
    const { tempWhitelist = {} } = await chrome.storage.local.get('tempWhitelist');
    toUnblock.forEach(key => { tempWhitelist[key] = { timestamp: Date.now() }; });
    await chrome.storage.local.set({ blocklist: newBlocklist, shadow_list: newShadowList, tempWhitelist });
}

function findTimerForDomain(domain, timers) {
    if (!domain) return 'web';
    
    // 1. Look for explicit matching domains first (ignoring 'web' and 'overall')
    for (const key of Object.keys(timers)) {
        if (key === 'web' || key === 'overall') continue;
        const timer = timers[key];
        
        if (Array.isArray(timer.domains)) {
            for (const d of timer.domains) {
                if (domain === d || domain.endsWith('.' + d)) {
                    // Check exclusions
                    if (Array.isArray(timer.excludedDomains)) {
                        const isExcluded = timer.excludedDomains.some(ed => domain === ed || domain.endsWith('.' + ed));
                        if (isExcluded) continue;
                    }
                    return timer.id;
                }
            }
        }
    }
    
    // 2. Check catch-all 'web' timer (excluding specified domains)
    const webTimer = timers['web'];
    if (webTimer) {
        if (Array.isArray(webTimer.excludedDomains)) {
            const isExcluded = webTimer.excludedDomains.some(ed => domain === ed || domain.endsWith('.' + ed));
            if (isExcluded) {
                return null;
            }
        }
        return 'web';
    }
    
    return null;
}

// --- Content Classification ---
async function handleContentData(data, tabId) {
    const { source, channel, subreddit, title, url } = data;
    const domain = getDomain(url);
    const blockKey = source === 'youtube' ? channel : (source === 'reddit' ? subreddit : domain);

    chrome.storage.session.set({ [tabId]: { status: 'classifying', key: blockKey, timestamp: Date.now() } });

    const stored = await chrome.storage.local.get([
        'blocklist', 'tempWhitelist', 'blockingMode', 'groqApiKey',
        'productiveContent', 'unwantedContent', 'userInstructions', 'intents', 'unproductiveTimers'
    ]);

    const timerId = findTimerForDomain(domain, stored.unproductiveTimers || {});

    // Temp whitelist check
    if (stored.tempWhitelist?.[blockKey] && (Date.now() - stored.tempWhitelist[blockKey].timestamp < TEN_MINUTES_MS)) {
        chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: "Manually unblocked", key: blockKey, timestamp: Date.now() } });
        return;
    }

    // Permanent blocklist check
    if (stored.blocklist?.includes(blockKey)) {
        return await blockAndRedirect(tabId, blockKey, "This content is on your blocklist.", true, null);
    }

    // Heuristic keyword analysis
    const heuristic = await analyzeWithKeywords(data, stored.intents);
    if (heuristic.decision === 'allow') {
        chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: heuristic.reason, key: blockKey, timestamp: Date.now() } });
        await appendToDiscoveryBuffer(title || blockKey);
        return;
    } else if (heuristic.decision === 'block') {
        await appendToDiscoveryBuffer(title || blockKey);
        return await handleUnproductiveClassification(tabId, blockKey, heuristic.reason, timerId, heuristic.intentId);
    }

    // LLM fallback
    if (stored.blockingMode === 'STRICT') {
        const res = await classifyStrictWithGroq(data, stored.groqApiKey, stored.productiveContent);
        if (res && res.productive_match) {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: res.reasoning, key: blockKey, timestamp: Date.now() } });
        } else {
            await handleUnproductiveClassification(tabId, blockKey, res?.reasoning || "Strict mode: no productive match.", timerId, null);
        }
    } else {
        const res = await classifyWithGroq(data, stored.groqApiKey, stored.productiveContent, stored.unwantedContent, stored.userInstructions);
        if (res && res.entertainment) {
            await handleUnproductiveClassification(tabId, blockKey, res.reasoning, timerId, null);
        } else {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: res?.reasoning || "Allowed", key: blockKey, timestamp: Date.now() } });
        }
    }
    await appendToDiscoveryBuffer(title || blockKey);
}

// --- Unproductive Classification Gate ---
async function handleUnproductiveClassification(tabId, blockKey, reasoning, timerId, intentId) {
    const { unproductiveTimers } = await chrome.storage.local.get(['unproductiveTimers']);
    const timers = unproductiveTimers || {};
    const timer = timers[timerId];
    const overall = timers.overall;

    // 1. Check overall timer limit
    if (overall) {
        if (overall.limitMinutes === 0) {
            return await blockAndRedirect(tabId, blockKey, "Overall limit: always block (0 min limit).", true, intentId);
        }
        if (overall.limitMinutes > 0 && overall.secondsUsedToday >= overall.limitMinutes * 60) {
            return await blockAndRedirect(tabId, blockKey, `Overall daily limit (${overall.limitMinutes}m) reached.`, false, null);
        }
    }

    // 2. If domain is excluded from all content timers (timerId is null)
    if (!timerId) {
        chrome.storage.session.set({ [tabId]: { entertainment: true, unrestricted: true, reasoning: 'Unproductive — excluded from all content timers', key: blockKey, timestamp: Date.now() } });
        return;
    }

    // 3. Check specific timer limit
    if (!timer || timer.limitMinutes < 0) {
        chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning: 'Allowed (no specific timer limit)', key: blockKey, timestamp: Date.now(), timerId } });
        startUnproductiveTimer(tabId, timerId);
        return;
    }

    if (timer.limitMinutes === 0) {
        return await blockAndRedirect(tabId, blockKey, `Content timer "${timer.name}": always block (0 min limit).`, true, intentId);
    }

    if (timer.secondsUsedToday >= timer.limitMinutes * 60) {
        return await blockAndRedirect(tabId, blockKey, `Daily limit for "${timer.name}" (${timer.limitMinutes}m) reached.`, false, null);
    }

    // Timer not yet exceeded — allow but track
    chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning, key: blockKey, timestamp: Date.now(), timerId } });
    startUnproductiveTimer(tabId, timerId);
}

// --- Block and Redirect ---
// permanent=true → add to blocklist (explicit block). permanent=false → day-scoped via timer counter only.
async function blockAndRedirect(tabId, key, reasoning, permanent = false, intentId = null) {
    if (permanent) await addToBlocklist(key);
    if (intentId) await appendToShadowList(key, intentId);
    chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning, key, timestamp: Date.now() } });
    handleBlockAction(tabId);
}

// --- Storage Helpers ---
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

async function appendToShadowList(urlId, intentId) {
    const { shadow_list = [] } = await chrome.storage.local.get('shadow_list');
    if (!shadow_list.find(e => e.url_id === urlId && e.blocked_by_intent === intentId)) {
        shadow_list.push({ url_id: urlId, blocked_by_intent: intentId, timestamp: Date.now() });
        await chrome.storage.local.set({ shadow_list });
    }
}

// --- Discovery Buffer ---
async function appendToDiscoveryBuffer(title) {
    if (!title) return;
    const { discoveryBuffer = [], groqApiKey, intents } = await chrome.storage.local.get(['discoveryBuffer', 'groqApiKey', 'intents']);
    // Sliding window: keep most recent 50
    discoveryBuffer.push(title);
    if (discoveryBuffer.length > MAX_DISCOVERY_BUFFER) discoveryBuffer.shift();

    if (discoveryBuffer.length >= MAX_DISCOVERY_BUFFER) {
        // Trigger discovery analysis
        const suggestions = await analyzeDiscoveryBuffer(discoveryBuffer, intents || [], groqApiKey);
        if (suggestions && suggestions.length > 0) {
            await chrome.storage.local.set({ pendingDiscovery: { suggestions, timestamp: Date.now() }, discoveryBuffer: [] });
            chrome.action.setBadgeText({ text: '!' });
            chrome.action.setBadgeBackgroundColor({ color: '#FF4081' });
        } else {
            await chrome.storage.local.set({ discoveryBuffer: [] });
        }
    } else {
        await chrome.storage.local.set({ discoveryBuffer });
    }
}

// --- Intent-Aware Keyword Matching ---
async function analyzeWithKeywords(data, intents) {
    const { heuristicDominanceRatio } = await chrome.storage.local.get(['heuristicDominanceRatio']);

    // If no intents, fall back to LLM
    if (!intents || intents.length === 0) return { decision: 'unknown', reason: 'No intents configured' };

    const dominance = typeof heuristicDominanceRatio === 'number' && heuristicDominanceRatio >= 1 ? heuristicDominanceRatio : 3.0;

    const fields = [data.title, data.description, data.content, data.channel, data.subreddit];
    if (Array.isArray(data.comments)) fields.push(data.comments.join('\n'));
    const text = fields.filter(Boolean).join('\n').toLowerCase();
    if (!text) return { decision: 'unknown', reason: 'No text' };

    const countHits = (keywords) => {
        let count = 0;
        (keywords || []).forEach(kw => {
            if (!kw) return;
            const pattern = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'gi');
            const matches = text.match(pattern);
            if (matches) count += matches.length;
        });
        return count;
    };

    // Evaluate each intent
    const unproductiveIntents = intents.filter(i => i.category === 'unproductive');
    const productiveIntents   = intents.filter(i => i.category === 'productive');

    let bestUnprodHits = 0, bestUnprodIntent = null;
    for (const intent of unproductiveIntents) {
        const hits = countHits(intent.keywords);
        if (hits > bestUnprodHits) { bestUnprodHits = hits; bestUnprodIntent = intent; }
    }

    let bestProdHits = 0, bestProdIntent = null;
    for (const intent of productiveIntents) {
        const hits = countHits(intent.keywords);
        if (hits > bestProdHits) { bestProdHits = hits; bestProdIntent = intent; }
    }

    const totalHits = bestUnprodHits + bestProdHits;
    if (totalHits < 3) return { decision: 'unknown', reason: 'Hits < 3' };

    // Specificity: check unproductive first
    if (bestUnprodHits >= 3) {
        const ratio = bestUnprodHits / Math.max(1, bestProdHits);
        if (ratio >= dominance) {
            return { decision: 'block', reason: `Unproductive intent "${bestUnprodIntent.original_phrase}" (ratio ${ratio.toFixed(2)})`, intentId: bestUnprodIntent.id };
        }
    }
    if (bestProdHits >= 3) {
        const ratio = bestProdHits / Math.max(1, bestUnprodHits);
        if (ratio >= dominance) {
            return { decision: 'allow', reason: `Productive intent "${bestProdIntent.original_phrase}" (ratio ${ratio.toFixed(2)})` };
        }
    }

    return { decision: 'unknown', reason: 'Inconclusive ratio' };
}
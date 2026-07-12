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

// --- Tab URL History and Grayscale Cleanups ---
async function getTabLastUrl(tabId) {
    const res = await chrome.storage.session.get([`lastUrl_${tabId}`]);
    return res[`lastUrl_${tabId}`] || null;
}
async function setTabLastUrl(tabId, url) {
    await chrome.storage.session.set({ [`lastUrl_${tabId}`]: url });
}
async function clearGrayscale(tabId) {
    try {
        await chrome.scripting.removeCSS({
            target: { tabId },
            css: "html { filter: grayscale(100%) !important; pointer-events: none !important; }"
        });
    } catch (e) { /* ignore */ }
}
function isTimerExceeded(domain, unproductiveTimers) {
    if (!unproductiveTimers) return null;
    const overall = unproductiveTimers.overall;
    if (overall && overall.limitMinutes >= 0 && overall.secondsUsedToday >= overall.limitMinutes * 60) {
        return "Overall Limit";
    }
    const timerId = findTimerForDomain(domain, unproductiveTimers);
    if (timerId && unproductiveTimers[timerId]) {
        const timer = unproductiveTimers[timerId];
        if (timer && timer.limitMinutes >= 0 && timer.secondsUsedToday >= timer.limitMinutes * 60) {
            return `Timer "${timer.name}"`;
        }
    }
    return null;
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
    await chrome.storage.session.remove([`lastUrl_${tabId}`]);
    const unproductiveSession = await getUnproductiveSession();
    if (unproductiveSession && unproductiveSession.tabId === tabId) {
        await pauseUnproductiveTimer(false);
    }
    const activeSession = await getActiveSession();
    if (activeSession && activeSession.tabId === tabId) {
        await stopSession();
    }
});

// --- Helpers ---
// --- Session State Helpers (persists across Service Worker suspension) ---
async function getActiveSession() {
    const res = await chrome.storage.session.get(['activeSession']);
    return res.activeSession || null;
}
async function setActiveSession(session) {
    if (session === null) {
        await chrome.storage.session.remove('activeSession');
    } else {
        await chrome.storage.session.set({ activeSession: session });
    }
}
async function getUnproductiveSession() {
    const res = await chrome.storage.session.get(['unproductiveSession']);
    return res.unproductiveSession || null;
}
async function setUnproductiveSession(session) {
    if (session === null) {
        await chrome.storage.session.remove('unproductiveSession');
    } else {
        await chrome.storage.session.set({ unproductiveSession: session });
    }
}

// --- Helpers ---
function getDomain(url) {
    try { return new URL(url).hostname; } catch (e) { return ""; }
}

function getCreatorIdentifier(data) {
    if (!data || !data.url) return '';
    const { source, channel, subreddit, url, author } = data;
    const domain = getDomain(url).toLowerCase();
    
    if (source === 'youtube' && channel) {
        return channel;
    }
    if (source === 'reddit' && subreddit) {
        return subreddit;
    }
    
    if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
        try {
            const parsed = new URL(url);
            const pathParts = parsed.pathname.replace(/^\/|\/$/g, '').split('/');
            if (pathParts[0] && pathParts[0].startsWith('@')) {
                return pathParts[0];
            }
            if (pathParts[0] === 'c' && pathParts[1]) {
                return pathParts[1];
            }
            if (pathParts[0] === 'user' && pathParts[1]) {
                return pathParts[1];
            }
        } catch (e) {}
    }
    
    if (domain.includes('reddit.com')) {
        try {
            const parsed = new URL(url);
            const pathParts = parsed.pathname.replace(/^\/|\/$/g, '').split('/');
            if (pathParts[0] === 'r' && pathParts[1]) {
                return pathParts[1];
            }
        } catch (e) {}
    }
    
    if (domain.includes('twitter.com') || domain.includes('x.com')) {
        try {
            const parsed = new URL(url);
            const pathParts = parsed.pathname.replace(/^\/|\/$/g, '').split('/');
            const username = pathParts[0];
            if (username && !['home', 'explore', 'notifications', 'messages', 'bookmarks', 'lists', 'settings', 'search', 'i', 'tos', 'privacy'].includes(username.toLowerCase())) {
                return '@' + username;
            }
        } catch (e) {}
    }
    
    if (domain.includes('instagram.com')) {
        if (author && !author.includes(' ')) {
            return '@' + author;
        }
        try {
            const parsed = new URL(url);
            const pathParts = parsed.pathname.replace(/^\/|\/$/g, '').split('/');
            const first = pathParts[0];
            if (first && !['p', 'reels', 'reel', 'stories', 'explore', 'direct', 'accounts', 'developer', 'emails'].includes(first.toLowerCase())) {
                return '@' + first;
            } else if (first === 'stories' && pathParts[1]) {
                return '@' + pathParts[1];
            }
        } catch (e) {}
    }
    
    if (domain.includes('medium.com')) {
        const subdomain = domain.split('.medium.com')[0];
        if (subdomain && subdomain !== 'medium' && subdomain !== 'www' && subdomain !== 'api') {
            return '@' + subdomain;
        }
        try {
            const parsed = new URL(url);
            const pathParts = parsed.pathname.replace(/^\/|\/$/g, '').split('/');
            if (pathParts[0] && pathParts[0].startsWith('@')) {
                return pathParts[0];
            }
        } catch (e) {}
    }
    
    if (domain.includes('substack.com')) {
        const parts = domain.split('.substack.com');
        if (parts.length > 1) {
            const subdomain = parts[0];
            if (subdomain && subdomain !== 'www' && subdomain !== 'substack' && subdomain !== 'api') {
                return subdomain;
            }
        }
    }
    
    return domain;
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

function urlMatchesHomepageRule(url, rule) {
    if (!url || !rule) return false;
    try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname.toLowerCase();
        const path = parsedUrl.pathname.toLowerCase().replace(/\/$/, '');
        
        let cleanRule = rule.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
        
        if (cleanRule.includes('/')) {
            const firstSlash = cleanRule.indexOf('/');
            const ruleHost = cleanRule.substring(0, firstSlash);
            const rulePath = cleanRule.substring(firstSlash).replace(/\/$/, '');
            
            const hostMatch = host === ruleHost || host.endsWith('.' + ruleHost);
            if (!hostMatch) return false;
            
            return path === rulePath || path.startsWith(rulePath + '/');
        } else {
            const hostMatch = host === cleanRule || host.endsWith('.' + cleanRule);
            if (!hostMatch) return false;
            
            if (path === '' || path === '/') return true;
            
            const commonHomePaths = [
                '/feed', '/home', '/feed/', '/home/', '/index.html', '/index.php'
            ];
            return commonHomePaths.includes(path);
        }
    } catch (e) { return false; }
}

function homepageRuleMatchesItem(url, item) {
    if (item && Array.isArray(item.domains)) {
        const matchesDomain = item.domains.some(d => urlMatchesHomepageRule(url, d));
        if (matchesDomain) {
            if (Array.isArray(item.excludedDomains)) {
                const isExcluded = item.excludedDomains.some(ed => urlMatchesHomepageRule(url, ed));
                if (isExcluded) return false;
            }
            return true;
        }
        return false;
    }
    return item ? urlMatchesHomepageRule(url, item.domain) : false;
}

function strictRuleMatchesItem(url, item) {
    if (item && Array.isArray(item.urls)) {
        const matchesUrl = item.urls.some(u => urlMatchesStrictRule(url, u));
        if (matchesUrl) {
            if (Array.isArray(item.excludedUrls)) {
                const isExcluded = item.excludedUrls.some(eu => urlMatchesStrictRule(url, eu));
                if (isExcluded) return false;
            }
            return true;
        }
        return false;
    }
    return item ? urlMatchesStrictRule(url, item.url) : false;
}

function exactUrlMatchesItem(url, item) {
    if (typeof item === 'string') {
        return url === item;
    }
    if (item && Array.isArray(item.urls)) {
        const matchesUrl = item.urls.some(u => url === u);
        if (matchesUrl) {
            if (Array.isArray(item.excludedUrls)) {
                const isExcluded = item.excludedUrls.some(eu => url === eu);
                if (isExcluded) return false;
            }
            return true;
        }
    }
    return false;
}

function getDomainClassification(url, classifications) {
    if (!url) return 'productive';
    const domain = getDomain(url).toLowerCase();
    if (!domain) return 'productive';
    const list = classifications || {};
    if (list[domain]) return list[domain];
    const keys = Object.keys(list);
    for (const key of keys) {
        if (domain.endsWith('.' + key)) {
            return list[key];
        }
    }
    return null;
}

// --- Unified Limit Enforcement Checker ---
async function checkAndEnforceLimit(tabId, key, limitMinutes, secondsUsedToday, blockReason, intentId = null) {
    if (limitMinutes === 0) {
        await blockAndRedirect(tabId, key, `${blockReason} (Always Blocked)`, true, intentId);
        return true;
    }
    if (limitMinutes > 0 && secondsUsedToday >= limitMinutes * 60) {
        await blockAndRedirect(tabId, key, `${blockReason} (Daily limit of ${limitMinutes}m reached)`, false, intentId);
        return true;
    }
    return false;
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

    // Developer overrides for testing
    const useMozillaForYoutube = false;
    const useMozillaForReddit = false;

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
async function startSession(tabId, url) {
    await stopSession();
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url === rickrollUrl) return;
    const domain = getDomain(url);
    if (!domain) return;
    await setActiveSession({ tabId, url, domain, startTime: Date.now() });
}

async function stopSession() {
    const session = await getActiveSession();
    if (!session) return;
    const elapsed = Math.round((Date.now() - session.startTime) / 1000);
    if (elapsed > 0) await recordTime(session.domain, elapsed, session.url, session.tabId);
    await setActiveSession(null);
}

// --- Unproductive Content Timer ---
async function startUnproductiveTimer(tabId, source) {
    await pauseUnproductiveTimer();
    await setUnproductiveSession({ tabId, source, startTime: Date.now() });
}

async function pauseUnproductiveTimer(enforceLimit = true) {
    const session = await getUnproductiveSession();
    if (!session) return;
    const elapsed = Math.round((Date.now() - session.startTime) / 1000);
    if (elapsed > 0) await recordUnproductiveTime(session.source, elapsed, session.tabId, enforceLimit);
    await setUnproductiveSession(null);
}

async function recordUnproductiveTime(source, seconds, tabId, enforceLimit = true) {
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
    
    if (!enforceLimit) return;
    
    // Check specific timer limit
    if (source && timers[source]) {
        const limit = timers[source].limitMinutes;
        const blocked = await checkAndEnforceLimit(tabId, timers[source].id, limit, timers[source].secondsUsedToday, `Content timer "${timers[source].name}"`);
        if (blocked) return;
    }
    
    // Check overall timer limit
    const overallLimit = timers.overall.limitMinutes;
    const blocked = await checkAndEnforceLimit(tabId, 'overall', overallLimit, timers.overall.secondsUsedToday, "Overall Content Limit");
    
    if (!blocked && tabId) {
        chrome.tabs.get(tabId, (tab) => {
            if (!chrome.runtime.lastError && tab && tab.url) {
                updateWarningBadge(tabId, tab.url);
            }
        });
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
            if (homepageRuleMatchesItem(url, item) && item.limitMinutes >= 0) {
                item.secondsUsedToday += seconds;
                const blockKey = item.name || item.domain;
                const blocked = await checkAndEnforceLimit(tabId, blockKey, item.limitMinutes, item.secondsUsedToday, `Homepage blocklist for ${blockKey}`);
                if (blocked) break;
            }
        }
        storageUpdate.homepageBlocklist = data.homepageBlocklist;
    }

    // Deprecated YouTube homepage timer fallback
    const isYoutubeHome = url === 'https://www.youtube.com/' || url === 'https://www.youtube.com';
    if (isYoutubeHome && data.youtubeLimit && data.youtubeLimit.limitMinutes >= 0) {
        data.youtubeLimit.secondsUsedToday += seconds;
        storageUpdate.youtubeLimit = data.youtubeLimit;
        const blocked = await checkAndEnforceLimit(tabId, 'youtube_home_fallback', data.youtubeLimit.limitMinutes, data.youtubeLimit.secondsUsedToday, "YouTube Homepage");
        if (blocked) return;
    }

    // Deprecated Reddit homepage timer fallback
    const isRedditHome = url === 'https://www.reddit.com/' || url === 'https://www.reddit.com';
    if (isRedditHome && data.redditLimit && data.redditLimit.limitMinutes >= 0) {
        data.redditLimit.secondsUsedToday += seconds;
        storageUpdate.redditLimit = data.redditLimit;
        const blocked = await checkAndEnforceLimit(tabId, 'reddit_home_fallback', data.redditLimit.limitMinutes, data.redditLimit.secondsUsedToday, "Reddit Homepage");
        if (blocked) return;
    }

    // Strict URL blocklist timers
    if (Array.isArray(data.strictUrlBlocklist)) {
        for (const item of data.strictUrlBlocklist) {
            if (strictRuleMatchesItem(url, item) && item.limitMinutes >= 0) {
                item.secondsUsedToday += seconds;
                const blockKey = item.name || item.url;
                const blocked = await checkAndEnforceLimit(tabId, blockKey, item.limitMinutes, item.secondsUsedToday, `Strict URL blocklist for ${blockKey}`);
                if (blocked) break;
            }
        }
        storageUpdate.strictUrlBlocklist = data.strictUrlBlocklist;
    }

    await chrome.storage.local.set(storageUpdate);
    if (tabId && url) {
        await updateWarningBadge(tabId, url);
    }
}

// --- Tab / Window Events ---
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await stopSession();
    await pauseUnproductiveTimer(false);
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            await startSession(tab.id, tab.url);
            await maybeResumeUnproductiveTimer(tab.id, tab.url);
            await updateWarningBadge(tab.id, tab.url);
        }
    } catch (e) { }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        await stopSession();
        await pauseUnproductiveTimer(false);
    } else {
        try {
            const [tab] = await chrome.tabs.query({ active: true, windowId });
            if (tab && tab.url) {
                await startSession(tab.id, tab.url);
                await maybeResumeUnproductiveTimer(tab.id, tab.url);
                await updateWarningBadge(tab.id, tab.url);
            }
        } catch (e) { }
    }
});

chrome.alarms.create('timeTracker', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'timeTracker') return;
    await checkAndResetDaily();

    const activeSession = await getActiveSession();
    if (activeSession) {
        const { tabId, url } = activeSession;
        await stopSession();
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.active) await startSession(tabId, tab.url || url);
        } catch (e) { }
    }
    const unproductiveSession = await getUnproductiveSession();
    if (unproductiveSession) {
        const { tabId, source } = unproductiveSession;
        await pauseUnproductiveTimer();
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.active && isContentPageUrl(tab.url)) {
                const sessionData = await chrome.storage.session.get(tabId.toString());
                const cls = sessionData[tabId];
                if (cls && cls.entertainment === true) await startUnproductiveTimer(tabId, source);
            }
        } catch (e) { }
    }

    // Clean stale rickroll guards
    const now = Date.now();
    for (const [id, ts] of recentlyBlockedTabs) { if (now - ts > 10000) recentlyBlockedTabs.delete(id); }

    // Update warning badge for active tab
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
            await updateWarningBadge(tab.id, tab.url);
        }
    } catch (e) { }
});

async function maybeResumeUnproductiveTimer(tabId, url) {
    const domain = getDomain(url);
    if (!domain) return;

    const sessionData = await chrome.storage.session.get(tabId.toString());
    const cls = sessionData[tabId];
    if (!cls || cls.entertainment !== true) return;

    const { unproductiveTimers } = await chrome.storage.local.get(['unproductiveTimers']);
    const timers = unproductiveTimers || {};
    
    // Check overall limit
    const overall = timers.overall;
    if (overall) {
        const blocked = await checkAndEnforceLimit(tabId, 'overall', overall.limitMinutes, overall.secondsUsedToday, "Overall Content Limit");
        if (blocked) return;
    }

    const timerId = findTimerForDomain(domain, timers);
    if (!timerId) return;

    const timer = timers[timerId];
    if (timer) {
        const blocked = await checkAndEnforceLimit(tabId, timer.id, timer.limitMinutes, timer.secondsUsedToday, `Content timer "${timer.name}"`);
        if (!blocked) {
            await startUnproductiveTimer(tabId, timerId);
        }
    }
}

// --- Check if URL is blocked (loop guard helper) ---
function checkIsUrlBlockedSync(url, stored) {
    const domain = getDomain(url);
    if (Array.isArray(stored.homepageBlocklist)) {
        const homeEntry = stored.homepageBlocklist.find(item => homepageRuleMatchesItem(url, item));
        if (homeEntry && homeEntry.limitMinutes >= 0) {
            if (homeEntry.limitMinutes === 0 || homeEntry.secondsUsedToday >= homeEntry.limitMinutes * 60) return true;
        }
    }
    const strictEntry = (stored.strictUrlBlocklist || []).find(item => strictRuleMatchesItem(url, item));
    if (strictEntry && strictEntry.limitMinutes >= 0) {
        if (strictEntry.limitMinutes === 0 || strictEntry.secondsUsedToday >= strictEntry.limitMinutes * 60) return true;
    }
    const exactEntry = (stored.exactUrlBlocklist || []).find(item => exactUrlMatchesItem(url, item));
    if (exactEntry) return true;

    const tempBlockKey = getCreatorIdentifier({ url });
    if (tempBlockKey) {
        const isTempWhitelisted = stored.tempWhitelist?.[tempBlockKey] && 
            (Date.now() - stored.tempWhitelist[tempBlockKey].timestamp < TEN_MINUTES_MS);
        if (!isTempWhitelisted && stored.blocklist?.includes(tempBlockKey)) return true;
    }

    const classification = getDomainClassification(url, stored.domainClassifications);
    if (classification === 'unproductive') {
        const timerId = findTimerForDomain(domain, stored.unproductiveTimers || {});
        const timer = timerId ? stored.unproductiveTimers?.[timerId] : null;
        const overall = stored.unproductiveTimers?.overall;
        if (overall && overall.limitMinutes >= 0 && overall.secondsUsedToday >= overall.limitMinutes * 60) return true;
        if (!timerId || !timer) return true; // No timer configured = blocked
        if (timer.limitMinutes >= 0 && timer.secondsUsedToday >= timer.limitMinutes * 60) return true;
    }
    return false;
}

async function handlePermanentBlocklist(tabId, blockKey, domain, unproductiveTimers) {
    const exceededName = isTimerExceeded(domain, unproductiveTimers);
    let reason = "This content is on your blocklist.";
    if (exceededName) {
        reason += ` (Content timer limit reached: ${exceededName})`;
    }
    await blockAndRedirect(tabId, blockKey, reason, true, null);
}

// --- Rule Evaluation helper ---
async function evaluateTabRules(tabId, tab) {
    if (!tab.url || tab.url === rickrollUrl) return;

    // Rickroll guard: skip re-blocking within 5s of a block
    const lastBlock = recentlyBlockedTabs.get(tabId);
    if (lastBlock && Date.now() - lastBlock < 5000) return;

    await checkAndResetDaily();

    const url = tab.url;
    
    // Get whitelist and check
    const stored = await chrome.storage.local.get([
        'domainClassifications', 'homepageBlocklist', 'strictUrlBlocklist', 'exactUrlBlocklist', 'youtubeLimit', 'redditLimit', 'unproductiveTimers', 'blocklist', 'tempWhitelist'
    ]);

    // Rickroll loop guard: if coming back from rickroll to a blocked page, escape loop
    const lastUrl = await getTabLastUrl(tabId);
    if (lastUrl === rickrollUrl) {
        const isBlocked = checkIsUrlBlockedSync(url, stored);
        if (isBlocked) {
            await setTabLastUrl(tabId, url);
            try {
                await chrome.tabs.goBack(tabId);
                return;
            } catch (e) {}
        }
    }
    await setTabLastUrl(tabId, url);

    // Dynamic Homepage Blocklist checks
    if (Array.isArray(stored.homepageBlocklist)) {
        const homeEntry = stored.homepageBlocklist.find(item => homepageRuleMatchesItem(url, item));
        if (homeEntry && homeEntry.limitMinutes >= 0) {
            const blockKey = homeEntry.name || homeEntry.domain;
            const blocked = await checkAndEnforceLimit(tabId, blockKey, homeEntry.limitMinutes, homeEntry.secondsUsedToday, `Homepage blocklist for ${blockKey}`);
            if (blocked) return;
        }
    }

    // Deprecated fallback checks
    const isYoutubeHome = url === 'https://www.youtube.com/' || url === 'https://www.youtube.com';
    const isRedditHome  = url === 'https://www.reddit.com/'  || url === 'https://www.reddit.com';

    if (isYoutubeHome && stored.youtubeLimit && stored.youtubeLimit.limitMinutes >= 0) {
        const blocked = await checkAndEnforceLimit(tabId, 'youtube_home_fallback', stored.youtubeLimit.limitMinutes, stored.youtubeLimit.secondsUsedToday, "YouTube Homepage");
        if (blocked) return;
    }
    if (isRedditHome && stored.redditLimit && stored.redditLimit.limitMinutes >= 0) {
        const blocked = await checkAndEnforceLimit(tabId, 'reddit_home_fallback', stored.redditLimit.limitMinutes, stored.redditLimit.secondsUsedToday, "Reddit Homepage");
        if (blocked) return;
    }

    const strictEntry = (stored.strictUrlBlocklist || []).find(item => strictRuleMatchesItem(url, item));
    if (strictEntry && strictEntry.limitMinutes >= 0) {
        const blockKey = strictEntry.name || strictEntry.url;
        const blocked = await checkAndEnforceLimit(tabId, blockKey, strictEntry.limitMinutes, strictEntry.secondsUsedToday, `Strict URL blocklist for ${blockKey}`);
        if (blocked) return;
    }
    const exactEntry = (stored.exactUrlBlocklist || []).find(item => exactUrlMatchesItem(url, item));
    if (exactEntry) {
        const blockKey = typeof exactEntry === 'string' ? exactEntry : exactEntry.name;
        await blockAndRedirect(tabId, blockKey, "Exact URL blocklist", true, null);
        return;
    }

    // Creator-level blocklist bypass check (before script injection)
    const tempBlockKey = getCreatorIdentifier({ url });
    if (tempBlockKey && tempBlockKey !== getDomain(url)) {
        const isTempWhitelisted = stored.tempWhitelist?.[tempBlockKey] && 
            (Date.now() - stored.tempWhitelist[tempBlockKey].timestamp < TEN_MINUTES_MS);
        if (!isTempWhitelisted && stored.blocklist?.includes(tempBlockKey)) {
            const domain = getDomain(url);
            await handlePermanentBlocklist(tabId, tempBlockKey, domain, stored.unproductiveTimers);
            return;
        }
    }

    const classification = getDomainClassification(url, stored.domainClassifications);

    if (classification === 'depends') {
        await chrome.storage.session.set({ [tabId]: { status: 'classifying', key: getDomain(url), timestamp: Date.now() } });
        injectContentScript(tabId, url);
    } else if (classification === 'unproductive') {
        const blockKey = getDomain(url);
        const timerId = findTimerForDomain(blockKey, stored.unproductiveTimers || {});
        await handleUnproductiveClassification(tabId, blockKey, 'Unproductive Website (Categorized)', timerId, null);
    } else {
        const reason = classification === 'productive' ? 'Productive Website (Categorized)' : 'Uncategorized Website (Allowed)';
        await chrome.storage.session.set({ [tabId]: { status: 'allowed', reasoning: reason, key: getDomain(url), timestamp: Date.now() } });
        const unproductiveSession = await getUnproductiveSession();
        if (unproductiveSession && unproductiveSession.tabId === tabId) {
            await pauseUnproductiveTimer(false);
        }
        await clearGrayscale(tabId);
    }
}

// --- URL Updated ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const activeSession = await getActiveSession();
    const unproductiveSession = await getUnproductiveSession();
    if (activeSession && activeSession.tabId === tabId && changeInfo.url) {
        await stopSession();
        if (changeInfo.url !== rickrollUrl) await startSession(tabId, changeInfo.url);
    }
    if (unproductiveSession && unproductiveSession.tabId === tabId && changeInfo.url) {
        await pauseUnproductiveTimer(false);
    }
    if (changeInfo.url) {
        await clearGrayscale(tabId);
        await setTabLastUrl(tabId, changeInfo.url);
    }
    if (changeInfo.status !== 'complete' || !tab.url || tab.url === rickrollUrl) return;

    await evaluateTabRules(tabId, tab);
    await updateWarningBadge(tabId, tab.url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
    if (!details.url || details.url === rickrollUrl) return;
    await clearGrayscale(details.tabId);
    await setTabLastUrl(details.tabId, details.url);
    const unproductiveSession = await getUnproductiveSession();
    if (unproductiveSession && unproductiveSession.tabId === details.tabId) await pauseUnproductiveTimer(false);
    const activeSession = await getActiveSession();
    if (activeSession && activeSession.tabId === details.tabId) {
        await stopSession();
        await startSession(details.tabId, details.url);
    }
    await evaluateTabRules(details.tabId, { url: details.url });
    await updateWarningBadge(details.tabId, details.url);
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
    } else if (message.type === 'addToBlocklist') {
        addToBlocklist(message.key).then(() => sendResponse({ success: true }));
        return true;
    } else if (message.type === 'removeFromBlocklist') {
        removeFromBlocklist(message.key).then(() => sendResponse({ success: true }));
        return true;
    } else if (message.type === 'getClassification') {
        chrome.storage.session.get(message.tabId.toString(), res => sendResponse(res[message.tabId]));
        return true;
    } else if (message.type === 'reEvaluateTab') {
        chrome.tabs.get(message.tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) return;
            evaluateTabRules(message.tabId, tab);
        });
        sendResponse({ success: true });
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
    const blockKey = getCreatorIdentifier(data);

    chrome.storage.session.set({ [tabId]: { status: 'classifying', key: blockKey, timestamp: Date.now() } });

    const stored = await chrome.storage.local.get([
        'blocklist', 'tempWhitelist', 'blockingMode', 'groqApiKey',
        'productiveContent', 'unwantedContent', 'userInstructions', 'intents', 'unproductiveTimers'
    ]);

    const timerId = findTimerForDomain(domain, stored.unproductiveTimers || {});

    // Temp whitelist check
    if (stored.tempWhitelist?.[blockKey] && (Date.now() - stored.tempWhitelist[blockKey].timestamp < TEN_MINUTES_MS)) {
        chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: "Manually unblocked", key: blockKey, timestamp: Date.now() } });
        await clearGrayscale(tabId);
        return;
    }

    // Permanent blocklist check
    if (stored.blocklist?.includes(blockKey)) {
        await handlePermanentBlocklist(tabId, blockKey, domain, stored.unproductiveTimers);
        return;
    }

    // Heuristic keyword analysis
    const heuristic = await analyzeWithKeywords(data, stored.intents);
    if (heuristic.decision === 'allow') {
        chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: heuristic.reason, key: blockKey, timestamp: Date.now() } });
        await appendToDiscoveryBuffer(title || blockKey);
        await clearGrayscale(tabId);
        return;
    } else if (heuristic.decision === 'block') {
        await appendToDiscoveryBuffer(title || blockKey);
        await addToBlocklist(blockKey);
        if (heuristic.intentId) await appendToShadowList(blockKey, heuristic.intentId);
        await handleUnproductiveClassification(tabId, blockKey, heuristic.reason, timerId, heuristic.intentId);
        return;
    }

    // LLM fallback
    if (stored.blockingMode === 'STRICT') {
        const res = await classifyStrictWithGroq(data, stored.groqApiKey, stored.productiveContent);
        if (res && res.productive_match) {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: res.reasoning, key: blockKey, timestamp: Date.now() } });
            await clearGrayscale(tabId);
        } else {
            const reason = res?.reasoning || "Strict mode: no productive match.";
            await addToBlocklist(blockKey);
            await handleUnproductiveClassification(tabId, blockKey, reason, timerId, null);
            return;
        }
    } else {
        const res = await classifyWithGroq(data, stored.groqApiKey, stored.productiveContent, stored.unwantedContent, stored.userInstructions);
        if (res && res.entertainment) {
            const reason = res.reasoning;
            await addToBlocklist(blockKey);
            await handleUnproductiveClassification(tabId, blockKey, reason, timerId, null);
            return;
        } else {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: res?.reasoning || "Allowed", key: blockKey, timestamp: Date.now() } });
            await clearGrayscale(tabId);
        }
    }
    await appendToDiscoveryBuffer(title || blockKey);
}

// --- Unproductive Classification Gate ---
async function handleUnproductiveClassification(tabId, blockKey, reasoning, timerId, intentId) {
    const { unproductiveTimers } = await chrome.storage.local.get(['unproductiveTimers']);
    const timers = unproductiveTimers || {};
    const timer = timerId ? timers[timerId] : null;
    const overall = timers.overall;

    // 1. Check overall timer limit
    if (overall) {
        const blocked = await checkAndEnforceLimit(tabId, 'overall', overall.limitMinutes, overall.secondsUsedToday, `Overall Limit: ${reasoning}`, intentId);
        if (blocked) return;
    }

    // 2. If there is no content timer for that website (timerId is null or timer not found)
    if (!timerId || !timer) {
        await blockAndRedirect(tabId, blockKey, `No timer configured: ${reasoning}`, true, intentId);
        return;
    }

    // 3. Check specific timer limit
    if (timer.limitMinutes < 0) {
        await chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning: 'Allowed (no specific timer limit)', key: blockKey, timestamp: Date.now(), timerId } });
        await startUnproductiveTimer(tabId, timerId);
        await clearGrayscale(tabId);
        return;
    }

    const blocked = await checkAndEnforceLimit(tabId, timer.id, timer.limitMinutes, timer.secondsUsedToday, `Timer "${timer.name}": ${reasoning}`, intentId);
    if (blocked) return;

    // Timer not yet exceeded — allow but track
    await chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning, key: blockKey, timestamp: Date.now(), timerId } });
    await startUnproductiveTimer(tabId, timerId);
    await clearGrayscale(tabId);
}

// --- Block and Redirect ---
// permanent=true → add to blocklist (explicit block). permanent=false → day-scoped via timer counter only.
async function blockAndRedirect(tabId, key, reasoning, permanent = false, intentId = null) {
    const lastUrl = await getTabLastUrl(tabId);
    if (lastUrl === rickrollUrl) {
        try {
            await chrome.tabs.goBack(tabId);
            return;
        } catch (e) {}
    }
    if (permanent) await addToBlocklist(key);
    if (intentId) await appendToShadowList(key, intentId);
    await chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning, key, timestamp: Date.now() } });
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

    const dominance = typeof heuristicDominanceRatio === 'number' && heuristicDominanceRatio >= 1 ? heuristicDominanceRatio : 2.0;

    const fields = [data.title, data.description, data.content, data.channel, data.subreddit];
    if (Array.isArray(data.comments)) fields.push(data.comments.join('\n'));
    const text = fields.filter(Boolean).join('\n').toLowerCase();
    if (!text) return { decision: 'unknown', reason: 'No text' };

    const countHits = (intent) => {
        let count = 0;
        const keywords = [...(intent.keywords || [])];
        
        // Programmatically inject the original phrase
        const original = (intent.original_phrase || '').toLowerCase().trim();
        if (original && !keywords.includes(original)) {
            keywords.push(original);
        }
        
        // For multi-word original phrases, inject their single-word components if they are unique and > 3 characters
        if (original.includes(' ')) {
            const words = original.split(/\s+/).filter(w => w.length > 3);
            words.forEach(w => {
                if (!keywords.includes(w)) keywords.push(w);
            });
        }

        keywords.forEach(kw => {
            if (!kw) return;
            const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Match standard word boundaries, or hashtag prefix, or hyphenated bounds, and support plural suffixes
            const pattern = new RegExp(`(?:\\b|#)${escaped}(?:\\b|s|es)`, 'gi');
            const matches = text.match(pattern);
            if (matches) count += matches.length;

            // Also support hashtag matching for multi-word phrases (e.g., "genshin impact" matches "#GenshinImpact")
            if (kw.includes(' ')) {
                const joint = kw.replace(/\s+/g, '');
                const jointPattern = new RegExp(`(?:\\b|#)${joint}(?:\\b|s|es)`, 'gi');
                const jointMatches = text.match(jointPattern);
                if (jointMatches) count += jointMatches.length;
            }
        });
        return count;
    };

    // Evaluate each intent
    const unproductiveIntents = intents.filter(i => i.category === 'unproductive');
    const productiveIntents   = intents.filter(i => i.category === 'productive');

    let bestUnprodHits = 0, bestUnprodIntent = null;
    for (const intent of unproductiveIntents) {
        const hits = countHits(intent);
        if (hits > bestUnprodHits) { bestUnprodHits = hits; bestUnprodIntent = intent; }
    }

    let bestProdHits = 0, bestProdIntent = null;
    for (const intent of productiveIntents) {
        const hits = countHits(intent);
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

// --- Storage Changes Listener for Automatic Blocklist / Timer Addition & Cleanups ---
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.domainClassifications) {
        const oldClass = changes.domainClassifications.oldValue || {};
        const newClass = changes.domainClassifications.newValue || {};
        
        const { strictUrlBlocklist, unproductiveTimers } = await chrome.storage.local.get(['strictUrlBlocklist', 'unproductiveTimers']);
        const currentStrictList = strictUrlBlocklist || [];
        const currentTimers = unproductiveTimers || {};
        
        let needsStrictUpdate = false;
        let needsTimersUpdate = false;
        
        // 1. Check for additions / changes to unproductive or depends
        for (const [domain, category] of Object.entries(newClass)) {
            const oldCategory = oldClass[domain];
            
            // If newly unproductive
            if (category === 'unproductive' && oldCategory !== 'unproductive') {
                const exists = currentStrictList.some(item => item.url.toLowerCase() === domain.toLowerCase());
                if (!exists) {
                    currentStrictList.push({
                        url: domain.toLowerCase(),
                        limitMinutes: 10,
                        secondsUsedToday: 0
                    });
                    needsStrictUpdate = true;
                }
            }
            
            // If newly depends
            if (category === 'depends' && oldCategory !== 'depends') {
                let domainCovered = false;
                for (const timer of Object.values(currentTimers)) {
                    if (timer.isOverall) continue;
                    if (Array.isArray(timer.domains) && timer.domains.includes(domain.toLowerCase())) {
                        domainCovered = true;
                        break;
                    }
                }
                
                if (!domainCovered) {
                    const timerKey = 'timer_' + domain.toLowerCase().replace(/\./g, '_');
                    currentTimers[timerKey] = {
                        id: timerKey,
                        name: `${domain} Content`,
                        domains: [domain.toLowerCase()],
                        excludedDomains: [],
                        limitMinutes: 10,
                        secondsUsedToday: 0
                    };
                    // Exclude from web timer catch-all exclusions
                    if (currentTimers.web && Array.isArray(currentTimers.web.excludedDomains)) {
                        if (!currentTimers.web.excludedDomains.includes(domain.toLowerCase())) {
                            currentTimers.web.excludedDomains.push(domain.toLowerCase());
                        }
                    }
                    needsTimersUpdate = true;
                }
            }
        }

        // 2. Check for removals or changes away from unproductive or depends
        for (const [domain, oldCategory] of Object.entries(oldClass)) {
            const newCategory = newClass[domain];
            
            // If was unproductive and is no longer unproductive
            if (oldCategory === 'unproductive' && newCategory !== 'unproductive') {
                const index = currentStrictList.findIndex(item => item.url.toLowerCase() === domain.toLowerCase());
                if (index !== -1) {
                    currentStrictList.splice(index, 1);
                    needsStrictUpdate = true;
                }
            }
            
            // If was depends and is no longer depends
            if (oldCategory === 'depends' && newCategory !== 'depends') {
                const timerKey = 'timer_' + domain.toLowerCase().replace(/\./g, '_');
                if (currentTimers[timerKey]) {
                    delete currentTimers[timerKey];
                    needsTimersUpdate = true;
                } else {
                    for (const [key, timer] of Object.entries(currentTimers)) {
                        if (timer.isOverall || key === 'youtube' || key === 'reddit' || key === 'web') continue;
                        if (Array.isArray(timer.domains) && timer.domains.includes(domain.toLowerCase())) {
                            delete currentTimers[key];
                            needsTimersUpdate = true;
                        }
                    }
                }
                
                // Remove from web exclusions
                if (currentTimers.web && Array.isArray(currentTimers.web.excludedDomains)) {
                    const idx = currentTimers.web.excludedDomains.indexOf(domain.toLowerCase());
                    if (idx !== -1) {
                        currentTimers.web.excludedDomains.splice(idx, 1);
                        needsTimersUpdate = true;
                    }
                }
            }
        }
        
        const update = {};
        if (needsStrictUpdate) {
            update.strictUrlBlocklist = currentStrictList;
        }
        if (needsTimersUpdate) {
            update.unproductiveTimers = currentTimers;
        }
        if (Object.keys(update).length > 0) {
            await chrome.storage.local.set(update);
        }
    }
});

async function updateWarningBadge(tabId, url) {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url === rickrollUrl) {
        chrome.action.setBadgeText({ text: "", tabId });
        return;
    }
    
    const domain = getDomain(url);
    if (!domain) {
        chrome.action.setBadgeText({ text: "", tabId });
        return;
    }
    
    try {
        const { domainClassifications, homepageBlocklist, strictUrlBlocklist, unproductiveTimers } = await chrome.storage.local.get([
            'domainClassifications', 'homepageBlocklist', 'strictUrlBlocklist', 'unproductiveTimers'
        ]);
        
        const matched = [];
        
        // 1. Strict URL
        if (Array.isArray(strictUrlBlocklist)) {
            const strict = strictUrlBlocklist.find(item => strictRuleMatchesItem(url, item) && item.limitMinutes >= 0);
            if (strict) matched.push(strict);
        }
        
        // 2. Homepage
        if (Array.isArray(homepageBlocklist)) {
            const home = homepageBlocklist.find(item => homepageRuleMatchesItem(url, item) && item.limitMinutes >= 0);
            if (home) matched.push({ limitMinutes: home.limitMinutes, secondsUsedToday: home.secondsUsedToday });
        }
        
        // 3. Content Timers
        const classification = getDomainClassification(url, domainClassifications);
        let contentTimerApplies = false;
        if (classification === 'unproductive') {
            contentTimerApplies = true;
        } else {
            const sessionData = await chrome.storage.session.get(tabId.toString());
            const cls = sessionData[tabId];
            if (cls && cls.entertainment) {
                contentTimerApplies = true;
            }
        }
        
        if (contentTimerApplies && unproductiveTimers) {
            const timerId = findTimerForDomain(domain, unproductiveTimers);
            if (timerId && unproductiveTimers[timerId] && unproductiveTimers[timerId].limitMinutes >= 0) {
                matched.push(unproductiveTimers[timerId]);
            }
            if (unproductiveTimers.overall && unproductiveTimers.overall.limitMinutes >= 0) {
                matched.push(unproductiveTimers.overall);
            }
        }
        
        // Find if any timer is getting close (<= 2 minutes remaining)
        let minRemainingSecs = Infinity;
        for (const timer of matched) {
            const total = timer.limitMinutes * 60;
            const remaining = total - timer.secondsUsedToday;
            if (remaining < minRemainingSecs) {
                minRemainingSecs = remaining;
            }
        }
        
        if (minRemainingSecs <= 120 && minRemainingSecs > 0) {
            const mins = Math.ceil(minRemainingSecs / 60);
            chrome.action.setBadgeText({ text: `${mins}m`, tabId });
            chrome.action.setBadgeBackgroundColor({ color: '#EF5350', tabId });
        } else {
            // Check if there is pendingDiscovery badge, otherwise clear
            const { pendingDiscovery } = await chrome.storage.local.get('pendingDiscovery');
            if (!pendingDiscovery) {
                chrome.action.setBadgeText({ text: "", tabId });
            }
        }
    } catch (e) {
        // Tab might be closed or invalid
    }
}

// --- Default Storage Initialization ---
chrome.runtime.onInstalled.addListener(async () => {
    const res = await chrome.storage.local.get(['domainClassifications', 'homepageBlocklist', 'unproductiveTimers']);
    const update = {};
    if (!res.domainClassifications) {
        update.domainClassifications = {
            'youtube.com': 'depends',
            'youtu.be': 'depends',
            'reddit.com': 'depends',
            'twitter.com': 'depends',
            'x.com': 'depends',
            'google.com': 'productive',
            'google.co.in': 'productive',
            'bing.com': 'productive',
            'duckduckgo.com': 'productive',
            'yahoo.com': 'productive',
            'github.com': 'productive',
            'gitlab.com': 'productive',
            'bitbucket.org': 'productive',
            'notion.so': 'productive',
            'notion.site': 'productive',
            'slack.com': 'productive',
            'zoom.us': 'productive',
            'localhost': 'productive',
            '127.0.0.1': 'productive',
            'sheets.google.com': 'productive',
            'docs.google.com': 'productive',
            'drive.google.com': 'productive',
            'gmail.com': 'productive',
            'trello.com': 'productive',
            'linear.app': 'productive',
            'figma.com': 'productive',
            'canva.com': 'productive',
            'stackoverflow.com': 'productive',
            'stackexchange.com': 'productive',
            'facebook.com': 'unproductive',
            'instagram.com': 'unproductive',
            'tiktok.com': 'unproductive'
        };
    }
    if (!res.homepageBlocklist) {
        update.homepageBlocklist = [
            { domain: 'youtube.com', limitMinutes: -1, secondsUsedToday: 0 },
            { domain: 'reddit.com', limitMinutes: -1, secondsUsedToday: 0 }
        ];
    }
    if (!res.unproductiveTimers) {
        update.unproductiveTimers = {
            overall: { id: 'overall', name: 'Overall Limit', domains: [], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0, isOverall: true },
            youtube: { id: 'youtube', name: 'YouTube', domains: ['youtube.com', 'youtu.be'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
            reddit:  { id: 'reddit', name: 'Reddit', domains: ['reddit.com'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
            web:     { id: 'web', name: 'Other Websites', domains: ['*'], excludedDomains: ['youtube.com', 'youtu.be', 'reddit.com'], limitMinutes: -1, secondsUsedToday: 0 }
        };
    }
    if (Object.keys(update).length > 0) {
        await chrome.storage.local.set(update);
    }
});
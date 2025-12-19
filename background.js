// background.js
import { 
    generateKeywordMaps, 
    generateUserInstructions, 
    classifyWithGroq, 
    classifyStrictWithGroq 
} from './ai-service.js';

const rickrollUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const TEN_MINUTES_MS = 10 * 60 * 1000;

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

// Unified Injection Function
function injectContentScript(tabId, url) {
    let file = null;
    if (url.includes("youtube.com/watch")) file = 'youtube.js';
    else if (url.includes("reddit.com/r/")) file = 'reddit.js';

    if (file) {
        console.log(`Injecting ${file} into tab ${tabId}`);
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

// --- Heuristic Analysis using Keyword Maps ---
async function analyzeWithKeywords(data) {
    console.log('Heuristic: running...');
    const { keywordMaps, heuristicDominanceRatio } = await chrome.storage.local.get(['keywordMaps', 'heuristicDominanceRatio']);
    if (!keywordMaps) return { decision: 'unknown', reason: 'No keyword maps available.' };
    
    const dominance = typeof heuristicDominanceRatio === 'number' && heuristicDominanceRatio >= 1 ? heuristicDominanceRatio : 2.0;

    const fields = [data.title, data.description, data.content, data.channel, data.subreddit];
    if (Array.isArray(data.comments)) fields.push(data.comments.join('\n'));
    const text = fields.filter(Boolean).join('\n').toLowerCase();
    
    if (!text) return { decision: 'unknown', reason: 'Insufficient content text.' };

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

    if (totalHits < 3) return { decision: 'unknown', reason: `Low hits (prod=${prodHits}, unwn=${unwnHits})` };

    const ratio = unwnHits / Math.max(1, prodHits);
    if (unwnHits >= 3 && ratio >= dominance) return { decision: 'block', reason: `Unwanted dominates (Ratio: ${ratio.toFixed(2)})` };
    
    const invRatio = prodHits / Math.max(1, unwnHits);
    if (prodHits >= 3 && invRatio >= dominance) return { decision: 'allow', reason: `Productive dominates (Ratio: ${invRatio.toFixed(2)})` };

    return { decision: 'unknown', reason: `Inconclusive ratio (${prodHits}:${unwnHits})` };
}
// 1. Initial Page Loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url || tab.url === rickrollUrl) return;

    const url = tab.url;
    chrome.storage.local.get(['blockYoutubeHomepage', 'blockRedditHomepage', 'strictUrlBlocklist', 'exactUrlBlocklist'], (res) => {
        // Blocklist/Homepage Logic
        const isYoutubeHome = url === 'https://www.youtube.com/' || url === 'https://www.youtube.com';
        const isRedditHome = url === 'https://www.reddit.com/' || url === 'https://www.reddit.com';

        if ((isYoutubeHome && res.blockYoutubeHomepage) || (isRedditHome && res.blockRedditHomepage)) {
            return chrome.tabs.update(tabId, { url: rickrollUrl });
        }

        const strictMatch = (res.strictUrlBlocklist || []).some(u => urlMatchesStrictRule(url, u));
        const exactMatch = (res.exactUrlBlocklist || []).includes(url);
        if (strictMatch || exactMatch) return chrome.tabs.update(tabId, { url: rickrollUrl });

        // If not blocked, inject the analyzer
        injectContentScript(tabId, url);
    });
});



// 2. SPA Navigations
chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
    if (details.url && details.url !== rickrollUrl) {
        injectContentScript(details.tabId, details.url);
    }
});

// 3. Centralized Message Handler (Controller)
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
    const { source, channel, subreddit, url } = data;
    const blockKey = source === 'youtube' ? channel : subreddit;

    // 1. Initial UI State
    chrome.storage.session.set({ [tabId]: { status: 'classifying', key: blockKey, timestamp: Date.now() } });

    // 2. Local Checks (Whitelist / Cache)
    const { blocklist, tempWhitelist, blockingMode, groqApiKey, productiveContent, unwantedContent, userInstructions } = 
        await chrome.storage.local.get(['blocklist', 'tempWhitelist', 'blockingMode', 'groqApiKey', 'productiveContent', 'unwantedContent', 'userInstructions']);

    if (tempWhitelist?.[blockKey] && (Date.now() - tempWhitelist[blockKey].timestamp < TEN_MINUTES_MS)) {
        return chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: "Manually unblocked", key: blockKey, timestamp: Date.now() } });
    }
    
    if (blocklist?.includes(blockKey)) {
        return await blockAndRedirect(tabId, blockKey, "This content is on your blocklist.");
    }

    // 3. Heuristic Check
    const heuristic = await analyzeWithKeywords(data);
    if (heuristic.decision === 'allow') {
        return chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: heuristic.reason, key: blockKey, timestamp: Date.now() } });
    } else if (heuristic.decision === 'block') {
        return await blockAndRedirect(tabId, blockKey, heuristic.reason);
    }

    // 4. AI Fallback (The Service)
    console.log(`Heuristic inconclusive. Falling back to AI for ${blockKey}`);
    
    if (blockingMode === 'STRICT') {
        const res = await classifyStrictWithGroq(data, groqApiKey, productiveContent);
        if (res && res.productive_match) {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: res.reasoning, key: blockKey, timestamp: Date.now() } });
        } else {
            await blockAndRedirect(tabId, blockKey, res?.reasoning || "Strict mode: No productive match found.");
        }
    } else {
        const res = await classifyWithGroq(data, groqApiKey, productiveContent, unwantedContent, userInstructions);
        if (res && res.entertainment) {
            await blockAndRedirect(tabId, blockKey, res.reasoning);
        } else {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: res?.reasoning || "Lenient mode: Allowed", key: blockKey, timestamp: Date.now() } });
        }
    }
}

async function blockAndRedirect(tabId, key, reasoning) {
    await addToBlocklist(key);
    chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning, key, timestamp: Date.now() } });
    chrome.tabs.update(tabId, { url: rickrollUrl });
}

// --- Browser Events & Storage Helpers ---
async function getBlocklist() {
    const res = await chrome.storage.local.get({blocklist: []});
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
const rickrollUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const TEN_MINUTES_MS = 10 * 60 * 1000;

function urlMatchesStrictRule(url, rule) {
    if (!url || !rule) return false;
    const trimmed = rule.trim();
    if (!trimmed) return false;
    try {
        const current = new URL(url);
        if (/^https?:\/\//i.test(trimmed)) {
            return url.startsWith(trimmed);
        }
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
        const hostMatches = host === hostPart || host.endsWith('.' + hostPart);
        const pathMatches = path.startsWith(pathPart);
        return hostMatches && pathMatches;
    } catch (e) {
        return url.startsWith(trimmed);
    }
}

// 1. Listen for tab updates for initial loads and homepage/website blocking
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) {
        return;
    }

    const url = tab.url;

    chrome.storage.local.get(['blockYoutubeHomepage', 'blockRedditHomepage', 'strictUrlBlocklist', 'exactUrlBlocklist'], (result) => {
        const blockYoutubeHomepage = !!(result && result.blockYoutubeHomepage);
        const blockRedditHomepage = !!(result && result.blockRedditHomepage);
        const strictUrls = Array.isArray(result && result.strictUrlBlocklist) ? result.strictUrlBlocklist : [];
        const exactUrls = Array.isArray(result && result.exactUrlBlocklist) ? result.exactUrlBlocklist : [];
        try {
            console.log('Tabs.onUpdated: completed load', { tabId, url, blockYoutubeHomepage, blockRedditHomepage, strictUrlCount: strictUrls.length, exactUrlCount: exactUrls.length });
        } catch (_) {}

        const isYoutubeHomepage = url === 'https://www.youtube.com/' || url === 'https://www.youtube.com';
        const isRedditHomepage = url === 'https://www.reddit.com/' || url === 'https://www.reddit.com';

        if (isYoutubeHomepage && blockYoutubeHomepage) {
            console.log('Tabs.onUpdated: blocking YouTube homepage by setting.');
            chrome.tabs.update(tabId, { url: rickrollUrl });
            return;
        }

        if (isRedditHomepage && blockRedditHomepage) {
            console.log('Tabs.onUpdated: blocking Reddit homepage by setting.');
            chrome.tabs.update(tabId, { url: rickrollUrl });
            return;
        }

        if (url && exactUrls.length > 0) {
            const exactMatch = exactUrls.includes(url);
            if (exactMatch) {
                console.log('Tabs.onUpdated: URL matched exact homepage blocklist. Redirecting.');
                chrome.tabs.update(tabId, { url: rickrollUrl });
                return;
            }
        }

        if (url && strictUrls.length > 0) {
            const match = strictUrls.some(u => urlMatchesStrictRule(url, u));
            if (match) {
                console.log('Tabs.onUpdated: URL matched website blocklist. Redirecting.');
                chrome.tabs.update(tabId, { url: rickrollUrl });
                return;
            }
        }

        // Inject youtube.js on initial page load since it's no longer in the manifest
        if (url.includes("youtube.com/watch")) {
            console.log(`YouTube page loaded. Injecting content script into tab ${tabId}`);
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['youtube.js']
            }, () => {
                if (chrome.runtime.lastError) {
                    // This error is common if the script is already being injected by another listener.
                    if (!chrome.runtime.lastError.message.includes("Cannot create a new script context for the page")) {
                        console.error(`Initial script injection failed for youtube.js: ${chrome.runtime.lastError.message}`);
                    }
                } else {
                    console.log("Successfully injected youtube.js on page load.");
                }
            });
        }
    });
});

// --- Keyword Map Generation (global) ---
async function generateKeywordMaps(userBio, groqApiKey) {
    if (!userBio) return null;
    const { productive = '', unwanted = '' } = userBio || {};
    const productiveTerms = productive.split(',').map(s => s.trim()).filter(Boolean);
    const unwantedTerms = unwanted.split(',').map(s => s.trim()).filter(Boolean);
    if (productiveTerms.length === 0 && unwantedTerms.length === 0) return null;
    try { console.log('KeywordMaps: generating', { productiveTermsCount: productiveTerms.length, unwantedTermsCount: unwantedTerms.length }); } catch (_) {}

    const prompt = `
You expand user-provided topics into keyword lists for fast local matching.

Return a single JSON object with two maps: "productive" and "unwanted".
Each map's keys are the EXACT user terms below, and each value is an array of 8-15 short keywords/phrases including synonyms, slang, channel names, common hashtags, and misspellings related to that term.
Keep keywords lowercase, concise, no duplicates, no explanations.

User terms:
- Productive: ${productiveTerms.join(', ') || 'None'}
- Unwanted: ${unwantedTerms.join(', ') || 'None'}

Output strictly as JSON like:
{
  "productive": { "<term>": ["k1","k2",...] },
  "unwanted": { "<term>": ["k1","k2",...] }
}`;

    try {
        try { console.log('KeywordMaps: sending request to GROQ'); } catch (_) {}
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqApiKey}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.2,
                max_tokens: 1000,
                top_p: 1,
                stream: false,
                stop: null
            })
        });
        const result = await response.json().catch(async (e) => {
            const text = await response.text().catch(() => '');
            console.error('KeywordMaps: failed to parse JSON body', e, text);
            return {};
        });
        try {
            console.log('KeywordMaps: raw GROQ response received', {
                ok: response.ok,
                status: response.status,
                hasError: !!(result && result.error),
                errorMessage: result && result.error ? (result.error.message || JSON.stringify(result.error)) : undefined,
                choices: Array.isArray(result.choices) ? result.choices.length : 'n/a'
            });
        } catch (_) {}
        if (!response.ok || result.error || !result.choices || result.choices.length === 0) {
            console.error('Invalid response from GROQ API for keyword maps:', result);
            return null;
        }
        const rawContent = result.choices[0].message.content;
        let parsed;
        try {
            parsed = JSON.parse(rawContent);
        } catch (e) {
            // Try to extract a JSON object from text
            try {
                const match = rawContent.match(/\{[\s\S]*\}/);
                if (match) parsed = JSON.parse(match[0]);
            } catch (_) {}
            if (!parsed) {
                console.error('KeywordMaps: failed to parse JSON content', { rawContent }, e);
                return null;
            }
        }

        // Normalize: lowercase and unique.
        // - Always include the original term itself as a keyword.
        // - Also include token-level pieces of each keyword phrase for fuzzier matching.
        const normalizeMap = (m = {}) => {
            const out = {};
            Object.keys(m).forEach(term => {
                const key = term.trim();
                const set = new Set((m[term] || []).map(x => (x || '').toString().toLowerCase().trim()).filter(Boolean));
                if (key) {
                    set.add(key.toLowerCase());
                }
                // Add token-level variants from all current keywords
                const existing = Array.from(set);
                existing.forEach(val => {
                    val.split(/[^a-z0-9]+/).forEach(tok => {
                        const t = tok.trim();
                        if (t.length >= 3) {
                            set.add(t);
                        }
                    });
                });
                out[key] = Array.from(set);
            });
            return out;
        };

        const maps = {
            productive: normalizeMap(parsed.productive || {}),
            unwanted: normalizeMap(parsed.unwanted || {})
        };
        try {
            console.log('KeywordMaps: normalized maps', {
                productiveTerms: Object.keys(maps.productive || {}).length,
                unwantedTerms: Object.keys(maps.unwanted || {}).length
            });
        } catch (_) {}
        return maps;
    } catch (e) {
        console.error('Error generating keyword maps:', e);
        return null;
    }
}

// --- Heuristic Analysis using Keyword Maps (global) ---
async function analyzeWithKeywords(data) {
    try { console.log('Heuristic: entered analyzeWithKeywords'); } catch (_) {}
    const { keywordMaps, heuristicDominanceRatio } = await chrome.storage.local.get(['keywordMaps', 'heuristicDominanceRatio']);
    if (!keywordMaps) return { decision: 'unknown', reason: 'No keyword maps available.' };
    const dominance = typeof heuristicDominanceRatio === 'number' && heuristicDominanceRatio >= 1 ? heuristicDominanceRatio : 2.0;
    try { console.log('Heuristic: maps loaded', { productiveTerms: Object.keys(keywordMaps.productive || {}).length, unwantedTerms: Object.keys(keywordMaps.unwanted || {}).length, dominance }); } catch (_) {}

    // Collect text fields (include identifiers like channel/subreddit)
    const fields = [];
    if (data.title) fields.push(data.title);
    if (data.description) fields.push(data.description);
    if (data.content) fields.push(data.content);
    if (data.channel) fields.push(data.channel);
    if (data.subreddit) fields.push(data.subreddit);
    if (Array.isArray(data.comments)) fields.push(data.comments.join('\n'));
    const text = fields.join('\n').toLowerCase();
    if (!text) return { decision: 'unknown', reason: 'Insufficient content text.' };
    try { console.log('Heuristic: text prepared', { title: !!data.title, description: !!data.description, content: !!data.content, comments: Array.isArray(data.comments) ? data.comments.length : 0, textLength: text.length }); } catch (_) {}

    // Flatten keyword lists
    const flatten = (map) => Object.values(map || {}).flat();
    const productiveKw = new Set(flatten(keywordMaps.productive));
    const unwantedKw = new Set(flatten(keywordMaps.unwanted));

    // Count occurrences (substring match, whole-word-ish by simple regex)
    const countMatches = (kwSet, label) => {
        let count = 0;
        const hitKeys = [];
        const hitsByKeyword = {};
        kwSet.forEach(kw => {
            if (!kw) return;
            try {
                const pattern = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'gi');
                const matches = text.match(pattern);
                if (matches && matches.length > 0) {
                    const m = matches.length;
                    count += m;
                    hitKeys.push(kw);
                    hitsByKeyword[kw] = (hitsByKeyword[kw] || 0) + m;
                }
            } catch (_) {}
        });
        // Sort keywords by count desc
        const breakdown = Object.entries(hitsByKeyword)
            .sort((a,b) => b[1] - a[1])
            .map(([k,v]) => ({ keyword: k, hits: v }));
        try {
            console.log(`Heuristic: ${label} match summary`, {
                hits: count,
                uniqueKeywordsMatched: hitKeys.length,
                topKeywords: breakdown.slice(0, 20)
            });
        } catch (_) {}
        return { count, hitKeys, hitsByKeyword, breakdown };
    };

    const prod = countMatches(productiveKw, 'productive');
    const unwn = countMatches(unwantedKw, 'unwanted');
    const prodHits = prod.count;
    const unwnHits = unwn.count;
    try {
        console.log('Heuristic: totals', { prodHits, unwnHits, totalHits: prodHits + unwnHits });
        console.log('Heuristic: productive breakdown', prod.breakdown.slice(0, 50));
        console.log('Heuristic: unwanted breakdown', unwn.breakdown.slice(0, 50));
    } catch (_) {}

    const totalHits = prodHits + unwnHits;
    if (totalHits < 3) {
        try { console.log('Heuristic: inconclusive due to low total hits'); } catch (_) {}
        return { decision: 'unknown', reason: `Too few keyword hits (prod=${prodHits}, unwn=${unwnHits}).` };
    }

    // Decision thresholds
    const ratio = unwnHits / Math.max(1, prodHits);
    if (unwnHits >= 3 && ratio >= dominance) {
        try { console.log('Heuristic: decision block', { unwnHits, prodHits, ratio, dominance }); } catch (_) {}
        return { decision: 'block', reason: `Unwanted dominates (unwanted=${unwnHits}, productive=${prodHits}, ratio=${ratio.toFixed(2)}).` };
    }
    const invRatio = prodHits / Math.max(1, unwnHits);
    if (prodHits >= 3 && invRatio >= dominance) {
        try { console.log('Heuristic: decision allow', { prodHits, unwnHits, ratio: invRatio, dominance }); } catch (_) {}
        return { decision: 'allow', reason: `Productive dominates (productive=${prodHits}, unwanted=${unwnHits}, ratio=${invRatio.toFixed(2)}).` };
    }
    try { console.log('Heuristic: inconclusive ratio', { prodHits, unwnHits, ratio, invRatio, dominance }); } catch (_) {}
    const result = { decision: 'unknown', reason: `Inconclusive ratio (productive=${prodHits}, unwanted=${unwnHits}).` };
    try { console.log('Heuristic: returning result', result); } catch (_) {}
    return result;
}

// 2. Listen for SPA navigations
chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
    console.log("History state updated:", details.url);

    if (details.url && details.url.includes("youtube.com/watch")) {
        console.log(`YouTube navigation detected. Re-injecting content script into tab ${details.tabId}`);
        // Programmatically re-inject the content script to ensure it runs on SPA navigation.
        chrome.scripting.executeScript({
            target: { tabId: details.tabId },
            files: ['youtube.js']
        }, () => {
            if (chrome.runtime.lastError) {
                // This error is common if the script is already being injected by another listener.
                if (!chrome.runtime.lastError.message.includes("Cannot create a new script context for the page")) {
                    console.error(`Script injection failed for youtube.js: ${chrome.runtime.lastError.message}`);
                }
            } else {
                console.log("Successfully re-injected youtube.js.");
            }
        });

    } else if (details.url && details.url.includes("reddit.com/r/")) {
        // Reddit is working fine with messaging, so we'll keep that system for it.
        console.log(`Sending navigation-completed to Reddit tab ${details.tabId}`);
        chrome.tabs.sendMessage(details.tabId, { type: 'navigation-completed', url: details.url }, response => {
            if (chrome.runtime.lastError) {
                console.warn(`Could not send 'navigation-completed' to Reddit: ${chrome.runtime.lastError.message}.`);
            }
        });
    }
});

// 3. Listen for messages from content scripts or the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Received message:", message.type);
    if (message.type === 'contentData') {
        console.log("Received content data:", message.data);
        handleContentData(message.data, sender.tab.id);
        sendResponse({success: true}); // Acknowledge receipt
    } else if (message.type === 'removeFromBlocklist') {
        removeFromBlocklist(message.key).then(() => {
            sendResponse({success: true});
        });
    } else if (message.type === 'generateKeywordMaps') {
        console.log("Received request to generate keyword maps with bio:", message.userBio);
        generateKeywordMaps(message.userBio, message.groqApiKey).then(keywordMaps => {
            if (keywordMaps) {
                chrome.storage.local.set({ keywordMaps }, () => {
                    console.log("Keyword maps saved.");
                    chrome.storage.local.get(['keywordMaps'], (res) => {
                        const km = res.keywordMaps || {};
                        console.log('Keyword maps persisted snapshot', {
                            productiveTerms: km.productive ? Object.keys(km.productive).length : 0,
                            unwantedTerms: km.unwanted ? Object.keys(km.unwanted).length : 0,
                        });
                        sendResponse({ success: true });
                    });
                });
            } else {
                console.error("Keyword map generation failed.");
                sendResponse({ success: false });
            }
        });
    } else if (message.type === 'generateInstructions') {
        console.log("Received request to generate instructions with bio:", message.userBio);
        generateUserInstructions(message.userBio, message.groqApiKey).then(instructions => {
            if (instructions) {
                chrome.storage.local.set({ userInstructions: instructions }, () => {
                    console.log("User instructions saved:", instructions);
                    sendResponse({success: true});
                });
            } else {
                console.error("Instruction generation failed.");
                sendResponse({success: false});
            }
        });
    } else if (message.type === 'getClassification') {
        const tabId = message.tabId.toString();
        chrome.storage.session.get(tabId, (result) => {
            sendResponse(result[tabId]);
        });
    }
    return true; // Indicates that the response will be sent asynchronously
});

// 4. Clean up session storage when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.session.remove(tabId.toString());
    console.log(`Cleaned session storage for closed tab ${tabId}`);
});


async function handleContentData(data, tabId) {
    try {
        console.log('HandleContentData: entered', {
            tabId,
            source: data.source,
            channel: data.channel,
            subreddit: data.subreddit,
            titlePreview: (data.title || '').slice(0, 120),
            descriptionPreview: (data.description || data.content || '').slice(0, 120)
        });
    } catch (_) {}
    const { source, channel, subreddit } = data;
    const blockKey = source === 'youtube' ? channel : subreddit;

    // Set initial state for popup
    chrome.storage.session.set({ [tabId]: { status: 'classifying', key: blockKey, timestamp: Date.now() } });

    // Check temporary whitelist first
    const tempWhitelist = await getTempWhitelist();
    const whitelistEntry = tempWhitelist[blockKey];
    if (whitelistEntry && (Date.now() - whitelistEntry.timestamp < TEN_MINUTES_MS)) {
        console.log(`${blockKey} is in the temporary whitelist. Skipping analysis.`);
        chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: 'This content was recently manually unblocked.', key: blockKey, timestamp: Date.now() } });
        return;
    }

    // Load mode and website URL blocklists
    const { blockingMode, strictUrlBlocklist, exactUrlBlocklist } = await chrome.storage.local.get(['blockingMode', 'strictUrlBlocklist', 'exactUrlBlocklist']);
    const rawMode = blockingMode;
    const mode = (rawMode === 'STRICT' || rawMode === 'STRICTEST') ? 'STRICT' : 'LESS_STRICT';
    const strictUrls = Array.isArray(strictUrlBlocklist) ? strictUrlBlocklist : [];
    const exactUrls = Array.isArray(exactUrlBlocklist) ? exactUrlBlocklist : [];
    try {
        console.log('HandleContentData: mode + strictUrls', { mode, strictUrlCount: strictUrls.length, exactUrlCount: exactUrls.length });
    } catch (_) {}

    // Always: hard-block by URL if it matches exact or prefix website blocklists
    const currentUrl = data.url || null;
    const exactMatch = currentUrl && exactUrls.includes(currentUrl);
    const strictMatch = currentUrl && strictUrls.some(u => urlMatchesStrictRule(currentUrl, u));
    if (exactMatch || strictMatch) {
        console.log('Website blocklist: URL matched configured URL rules. Redirecting immediately.');
        chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning: 'This URL is blocked by your website rules.', key: currentUrl, timestamp: Date.now() } });
        chrome.tabs.update(tabId, { url: rickrollUrl });
        return;
    }

    // Print current keyword maps for visibility (for STRICT/LESS_STRICT modes)
    try {
        const { keywordMaps } = await chrome.storage.local.get(['keywordMaps']);
        console.log('Heuristic: current keywordMaps snapshot', keywordMaps);
    } catch (e) {
        console.warn('Heuristic: could not load keywordMaps for logging', e);
    }

    // Check permanent blocklist (cache)
    const blocklist = await getBlocklist();
    if (blocklist.includes(blockKey)) {
        console.log(`Redirecting ${blockKey} from cached blocklist.`);
        chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning: 'This content is on your blocklist.', key: blockKey, timestamp: Date.now() } });
        chrome.tabs.update(tabId, { url: rickrollUrl });
        return;
    }

    // If not found in cache or temp whitelist, handle based on mode
    if (mode === 'STRICT') {
        // STRICT: prioritize productive signals; if heuristic is inconclusive, defer to a productive-only LLM gate.
        const heuristic = await analyzeWithKeywords(data);
        try { console.log('STRICT mode heuristic result', heuristic); } catch (_) {}

        if (heuristic && heuristic.decision === 'allow') {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: 'STRICT mode: heuristic found strong productive signals.', key: blockKey, timestamp: Date.now() } });
            console.log('STRICT: allowing due to productive dominance in heuristic.');
            return;
        }

        if (heuristic && heuristic.decision === 'block') {
            chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning: 'STRICT mode: heuristic found strong unwanted/entertainment signals.', key: blockKey, timestamp: Date.now() } });
            console.log('STRICT: blocking due to unwanted dominance in heuristic.');
            await addToBlocklist(blockKey);
            chrome.tabs.update(tabId, { url: rickrollUrl });
            return;
        }

        // Heuristic is inconclusive: use productive-only LLM gate
        const strictClassification = await classifyStrictWithGroq(data);
        if (!strictClassification) {
            chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning: 'STRICT mode: LLM unavailable or invalid response; blocking by default.', key: blockKey, timestamp: Date.now() } });
            console.log('STRICT: LLM failed; blocking by default.');
            await addToBlocklist(blockKey);
            chrome.tabs.update(tabId, { url: rickrollUrl });
            return;
        }

        if (strictClassification.productive_match === true) {
            chrome.storage.session.set({ [tabId]: { entertainment: false, reasoning: `STRICT mode LLM: ${strictClassification.reasoning}`, key: blockKey, timestamp: Date.now() } });
            console.log('STRICT: LLM deemed content related to productive categories. Allowing.');
            return;
        }

        chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning: `STRICT mode LLM: content not clearly related to productive categories. ${strictClassification.reasoning || ''}`.trim(), key: blockKey, timestamp: Date.now() } });
        console.log('STRICT: LLM did not find strong relation to productive categories. Blocking.');
        await addToBlocklist(blockKey);
        chrome.tabs.update(tabId, { url: rickrollUrl });
        return;
    }

    // LESS_STRICT (default): heuristic first, then LLM fallback
    const heuristic = await analyzeWithKeywords(data);
    try { console.log('Heuristic: result object', heuristic); } catch (_) {}
    if (heuristic && heuristic.decision !== 'unknown') {
        const entertainment = heuristic.decision === 'block';
        const reasoning = heuristic.reason;
        chrome.storage.session.set({ [tabId]: { entertainment, reasoning, key: blockKey, timestamp: Date.now() } });
        if (entertainment) {
            console.log(`Heuristic classified ${blockKey} as entertainment. Blocking.`);
            await addToBlocklist(blockKey);
            chrome.tabs.update(tabId, { url: rickrollUrl });
        } else {
            console.log(`Heuristic classified ${blockKey} as not entertainment.`);
        }
        return;
    }

    console.log(`No confident heuristic decision for ${blockKey}. Classifying with GROQ.`);
    classifyWithGroq(data, tabId);
}

async function generateUserInstructions(userBio, groqApiKey) {
    if (!userBio || (!userBio.productive && !userBio.unwanted)) {
        console.log("Bio is empty, skipping instruction generation.");
        return null;
    }

    const generateUserInstructionsPrompt = `
        You are an intelligent context profiler that creates personalized classification rules.
        You will be given a user's preferences in two parts:
        1.  **Productive Content:** Topics the user finds educational or relevant.
        2.  **Unwanted Content:** Topics the user explicitly wants to avoid.

        User Preferences:
        - Productive Content: ${userBio.productive || 'Not specified'}
        - Unwanted Content: ${userBio.unwanted || 'Not specified'}

        Your Task:
        Analyze the preferences and create two concise lists for a content classification model:
        - Relevant_Topics: Generalize from the user's productive content. These are topics, styles, or keywords that the user would likely consider educational, useful, or professionally relevant.
        - Entertainment_Indicators: Generalize from the user's unwanted content and common entertainment patterns. These are types of content, tone, or formats that the user would likely consider primarily entertainment.

        Include short examples for each list.

        Output only a single valid JSON object in this format:
        { "relevant_topics": [ "short bullet or keyword #1", "..." ], "entertainment_indicators": [ "short bullet or keyword #1", "..." ] }

        Rules:
        - Do not include any text outside the JSON object.
        - Keep each bullet short and descriptive (max 6-8 words).
        - Infer and generalize sensibly from the preferences.
        - Ensure the JSON is syntactically valid.
        - Output only the JSON.
    `;

    console.log("Generating user instructions with prompt:", generateUserInstructionsPrompt);

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqApiKey}`
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [{ role: "user", content: generateUserInstructionsPrompt }],
                temperature: 0.2,
                max_tokens: 250,
                top_p: 1,
                stream: false,
                response_format: { type: "json_object" },
                stop: null
            })
        });

        const result = await response.json();
        if (!response.ok || result.error || !result.choices || result.choices.length === 0) {
            console.error("Invalid response from GROQ API for user instructions:", result);
            return null;
        }

        const rawContent = result.choices[0].message.content;
        console.log("Received raw instructions from GROQ:", rawContent);
        return JSON.parse(rawContent);

    } catch (error) {
        console.error("Error generating user instructions:", error);
        return null;
    }
}

async function classifyWithGroq(data, tabId) {
    const { groqApiKey, productiveContent, unwantedContent, userInstructions } = await chrome.storage.local.get(['groqApiKey', 'productiveContent', 'unwantedContent', 'userInstructions']);

    if (!groqApiKey) {
        console.log("GROQ API key not set. Cannot classify.");
        return;
    }

    const { source, channel, subreddit, title, content, description } = data;
    const blockKey = source === 'youtube' ? channel : subreddit;

    const prompt = `
        You are a strict content classification assistant. Your goal is to determine if a piece of content is 'entertainment' based on a user's specific preferences.

        **User Preferences:**
        - **Productive Content (High Priority):** The user considers these topics, creators, or keywords to be important, educational, or relevant to their work/research. Content matching these is CRITICALLY IMPORTANT and should ALWAYS be classified as NOT entertainment, unless it ALSO explicitly matches a keyword in the 'Unwanted Content' list. This rule takes precedence over all other analysis.
          - ${productiveContent || 'Not provided'}

        - **Unwanted Content (Explicit Block):** The user explicitly wants to block content matching these topics or keywords.
          - ${unwantedContent || 'Not provided'}

        - **Generated Instructions (General Guidance):**
          ${userInstructions ? JSON.stringify(userInstructions) : 'Not available'}

        **Content to Classify:**
        - Source: ${source}
        - ${source === 'youtube' ? 'Channel' : 'Subreddit'}: ${blockKey}
        - Title: ${title}
        - Content/Description: ${content || description || 'Not available'}

        **Your Task:**
        Follow the reasoning steps below. Then, provide your final classification in the specified JSON format.

        **Reasoning Steps:**
        1.  **Productive Match:** Analyze if the content (title, channel, description) matches any keywords from the 'Productive Content' list. State your finding.
        2.  **Unwanted Match:** Analyze if the content matches any keywords from the 'Unwanted Content' list. State your finding.
        3.  **General Analysis:** Analyze the general nature of the content (e.g., comedy sketch, lecture, news report, tutorial). 
        4.  **Conclusion:** Based on the rules below, state the final classification.
            *   **Rule A (Productive Override):** If a productive match is found, it is NOT entertainment (unless an unwanted match is also found).
            *   **Rule B (Unwanted Override):** If an unwanted match is found, it IS entertainment.
            *   **Rule C (Default):** Otherwise, classify based on the general analysis.

        **Output Format:**
        Respond ONLY with a single valid JSON object with two keys, "reasoning" and "entertainment".

        {
          "reasoning": "Step 1 (Productive): [Your finding]. Step 2 (Unwanted): [Your finding]. Step 3 (General): [Your analysis]. Step 4 (Conclusion): [Your conclusion statement based on the rules].",
          "entertainment": true/false
        }
    `;
    
    console.log("Sending prompt to GROQ for classification:", prompt);

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqApiKey}`
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 1000, // Increased to allow for longer reasoning
                top_p: 1,
                stream: false,
                stop: null
            })
        });

        const result = await response.json().catch(async (e) => {
            const text = await response.text().catch(() => '');
            console.error('Classification: failed to parse JSON body', e, text);
            return {};
        });
        console.log("Received raw response from GROQ:", JSON.stringify({ status: response.status, ok: response.ok, hasError: !!(result && result.error), error: result && result.error, choices: result && result.choices ? result.choices.length : 'n/a' }, null, 2));

        if (!response.ok || result.error || !result.choices || result.choices.length === 0) {
            console.error("Invalid response from GROQ API:", result);
            return; 
        }

        const rawContent = result.choices[0].message.content;
        let classification;
        try {
            classification = JSON.parse(rawContent);
        } catch (e) {
            // Try to extract JSON from text
            try {
                const match = rawContent.match(/\{[\s\S]*\}/);
                if (match) classification = JSON.parse(match[0]);
            } catch (_) {}
            if (!classification) {
                console.error("Failed to parse JSON from model response:", rawContent, e);
                return;
            }
        }

        console.log("GROQ Classification:", classification);

        const resultForPopup = {
            entertainment: classification.entertainment,
            reasoning: classification.reasoning,
            key: blockKey,
            timestamp: Date.now()
        };
        chrome.storage.session.set({ [tabId]: resultForPopup });

        if (classification.entertainment === true) {
            console.log(`Classified ${blockKey} as entertainment. Reason: ${classification.reasoning}. Blocking.`);
            await addToBlocklist(blockKey);
            chrome.tabs.update(tabId, { url: rickrollUrl });
        } else {
            console.log(`Classified ${blockKey} as not entertainment. Reason: ${classification.reasoning}.`);
        }

    } catch (error) {
        console.error("Error calling GROQ API:", error);
    }
}

// STRICT mode LLM gate: only checks whether content is related to productive categories
async function classifyStrictWithGroq(data) {
    const { groqApiKey, productiveContent } = await chrome.storage.local.get(['groqApiKey', 'productiveContent']);

    if (!groqApiKey) {
        console.log('STRICT LLM: GROQ API key not set.');
        return null;
    }
    if (!productiveContent) {
        console.log('STRICT LLM: No productiveContent configured.');
        return null;
    }

    const { source, channel, subreddit, title, content, description } = data;
    const blockKey = source === 'youtube' ? channel : subreddit;

    const prompt = `
You are a STRICT productive-content gatekeeper.

The user has provided ONLY the following list of productive topics/creators/keywords:

  ${productiveContent}

You must decide if the given content is SUBSTANTIALLY or PRIMARILY about one or more of these productive items.

Content details:
- Source: ${source}
- ${source === 'youtube' ? 'Channel' : 'Subreddit'}: ${blockKey}
- Title: ${title}
- Content/Description: ${content || description || 'Not available'}

Rules:
- Answer ONLY whether this content clearly belongs to the productive categories above.
- Ignore entertainment vs non-entertainment; you only check relation to the productive list.
- Be conservative: if you are unsure or relation is weak/indirect, treat it as NOT related.

Output format (JSON only):
{
  "reasoning": "short explanation of whether and why it matches the productive categories, or why it does not",
  "productive_match": true/false
}
`;

    console.log('STRICT LLM: sending productive-only gate prompt to GROQ');

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqApiKey}`
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 400,
                top_p: 1,
                stream: false,
                stop: null
            })
        });

        const result = await response.json().catch(async (e) => {
            const text = await response.text().catch(() => '');
            console.error('STRICT LLM: failed to parse JSON body', e, text);
            return {};
        });
        console.log('STRICT LLM: raw GROQ response meta', JSON.stringify({ status: response.status, ok: response.ok, hasError: !!(result && result.error), error: result && result.error, choices: result && result.choices ? result.choices.length : 'n/a' }, null, 2));

        if (!response.ok || result.error || !result.choices || result.choices.length === 0) {
            console.error('STRICT LLM: invalid response from GROQ API', result);
            return null;
        }

        const rawContent = result.choices[0].message.content;
        let strictClassification;
        try {
            strictClassification = JSON.parse(rawContent);
        } catch (e) {
            try {
                const match = rawContent.match(/\{[\s\S]*\}/);
                if (match) strictClassification = JSON.parse(match[0]);
            } catch (_) {}
            if (!strictClassification) {
                console.error('STRICT LLM: failed to parse JSON from model response', rawContent, e);
                return null;
            }
        }

        console.log('STRICT LLM: parsed classification', strictClassification);
        // Expecting { reasoning: string, productive_match: true/false }
        if (typeof strictClassification.productive_match !== 'boolean') {
            console.warn('STRICT LLM: missing productive_match field, treating as non-productive.');
            strictClassification.productive_match = false;
        }
        return strictClassification;

    } catch (error) {
        console.error('STRICT LLM: error calling GROQ API', error);
        return null;
    }
}

// --- Blocklist & Whitelist Helpers ---
async function getBlocklist() {
    const result = await chrome.storage.local.get({blocklist: []});
    return result.blocklist;
}

async function addToBlocklist(key) {
    const blocklist = await getBlocklist();
    if (!blocklist.includes(key)) {
        blocklist.push(key);
        await chrome.storage.local.set({ blocklist: blocklist });
        console.log("Updated blocklist:", blocklist);
    }
}

async function removeFromBlocklist(key) {
    let blocklist = await getBlocklist();
    blocklist = blocklist.filter(item => item !== key);
    await chrome.storage.local.set({ blocklist: blocklist });
    console.log(`Removed ${key} from blocklist.`);

    // Add to temporary whitelist
    const tempWhitelist = await getTempWhitelist();
    tempWhitelist[key] = { timestamp: Date.now() };
    await chrome.storage.local.set({ tempWhitelist: tempWhitelist });
    console.log(`Added ${key} to temporary whitelist for 10 minutes.`);
}

async function getTempWhitelist() {
    const result = await chrome.storage.local.get({tempWhitelist: {}});
    return result.tempWhitelist;
}
const rickrollUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const TEN_MINUTES_MS = 10 * 60 * 1000;

// 1. Listen for tab updates for initial loads and Reddit homepage
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Redirect Reddit homepage
    if (changeInfo.status === 'complete' && tab.url === "https://www.reddit.com/") {
        console.log("Redirecting Reddit homepage.");
        chrome.tabs.update(tabId, { url: rickrollUrl });
        return;
    }

    // Inject youtube.js on initial page load since it's no longer in the manifest
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes("youtube.com/watch")) {
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

    // Check permanent blocklist (cache)
    const blocklist = await getBlocklist();
    if (blocklist.includes(blockKey)) {
        console.log(`Redirecting ${blockKey} from cached blocklist.`);
        chrome.storage.session.set({ [tabId]: { entertainment: true, reasoning: 'This content is on your blocklist.', key: blockKey, timestamp: Date.now() } });
        chrome.tabs.update(tabId, { url: rickrollUrl });
        return;
    }

    // If not found in cache or temp whitelist, classify with GROQ
    console.log(`No cache hit for ${blockKey}. Classifying with GROQ.`);
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
                max_tokens: 400, // Increased to allow for longer reasoning
                top_p: 1,
                stream: false,
                response_format: { type: "json_object" },
                stop: null
            })
        });

        const result = await response.json();
        console.log("Received raw response from GROQ:", JSON.stringify(result, null, 2));

        if (!response.ok || result.error || !result.choices || result.choices.length === 0) {
            console.error("Invalid response from GROQ API:", result);
            return; 
        }

        const rawContent = result.choices[0].message.content;
        let classification;
        try {
            classification = JSON.parse(rawContent);
        } catch (e) {
            console.error("Failed to parse JSON from model response:", rawContent, e);
            return;
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
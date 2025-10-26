const rickrollUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

// 1. Reddit Homepage Redirect
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url === "https://www.reddit.com/") {
        chrome.tabs.update(tabId, { url: rickrollUrl });
    }
});

// 2. Listen for messages from content scripts or the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'contentData') {
        console.log("Received data:", message.data);
        handleContentData(message.data, sender.tab.id);
    } else if (message.type === 'removeFromBlocklist') {
        removeFromBlocklist(message.key).then(() => {
            sendResponse({success: true});
        });
    } else if (message.type === 'generateInstructions') {
        generateUserInstructions(message.userBio, message.groqApiKey).then(instructions => {
            chrome.storage.local.set({ userInstructions: instructions });
            sendResponse({success: true});
        });
    }
    return true; // Indicates that the response will be sent asynchronously
});

async function handleContentData(data, tabId) {
    const { source, channel, subreddit } = data;
    const blockKey = source === 'youtube' ? channel : subreddit;

    // 3. Check local cache first
    const blocklist = await getBlocklist();
    if (blocklist.includes(blockKey)) {
        console.log(`Redirecting ${blockKey} from cache.`);
        chrome.tabs.update(tabId, { url: rickrollUrl });
        return;
    }

    // =====================================================================================
    // PRODUCTION SECURITY COMMENT: DATABASE ACCESS
    // The following logic should be handled by a secure serverless API.
    // The extension should not know about the database.
    // 
    // HOW TO REFACTOR FOR PRODUCTION:
    // 1. Create a serverless function (e.g., on Vercel, Netlify, AWS Lambda).
    // 2. This function will have an endpoint like `POST /api/getClassification`.
    // 3. The function will take `{ blockKey }` as a parameter.
    // 4. It will connect to your Neon database securely on the server-side.
    // 5. It will query the database to see if the `blockKey` exists and what its classification is.
    // 6. It will return the classification to the extension (e.g., `{ classification: 'entertainment' }`).
    // 7. Replace the placeholder below with a `fetch` call to your new API endpoint.
    // =====================================================================================
    // 4. Check Neon DB (Placeholder for personal use)
    // const dbClassification = await checkNeonDb(blockKey); 
    // if (dbClassification === 'entertainment') {
    //     await addToBlocklist(blockKey);
    //     chrome.tabs.update(tabId, { url: rickrollUrl });
    //     return;
    // }

    // 5. If not found in cache or DB, classify with GROQ
    classifyWithGroq(data, tabId);
}

async function generateUserInstructions(userBio, groqApiKey) {
    if (!userBio) return null;

    const generateUserInstructionsPrompt = `
        You are an intelligent context profiler that creates personalized classification rules.
        You will be given a user's bio. Based on it, you must infer their main areas of expertise, interest, and professional or creative focus.
        Then, write clear, structured guidelines describing how to tell whether a piece of online content is "entertainment" or "relevant/educational" for that user.

        User Bio:
        ${userBio}

        Your Task:
        Analyze the bio and extract key interests or domains of knowledge (e.g., AI, web development, finance, gaming, art, etc.).
        Create two concise lists:
        - Relevant_Topics: Topics, styles, or keywords that the user would likely consider educational, useful, or professionally relevant.
        - Entertainment_Indicators: Types of content, tone, or formats that the user would likely consider primarily entertainment.

        Include short examples (not long explanations) for each list.

        Output only a single valid JSON object in this format:
        { "relevant_topics": [ "short bullet or keyword #1", "short bullet or keyword #2", "..." ], "entertainment_indicators": [ "short bullet or keyword #1", "short bullet or keyword #2", "..." ] }

        Rules:
        - Do not include any text outside the JSON object.
        - Keep each bullet short and descriptive (max 6–8 words).
        - Avoid redundancy or vague terms like “technology” or “fun.”
        - Infer and generalize sensibly from the bio — if the user lists multiple interests, include all major domains.
        - Ensure the JSON is syntactically valid (no trailing commas, quotes properly closed).
        - Output only the JSON.
    `;

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
                max_tokens: 200,
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
        return JSON.parse(rawContent);

    } catch (error) {
        console.error("Error generating user instructions:", error);
        return null;
    }
}

async function classifyWithGroq(data, tabId) {
    const { groqApiKey, userBio, userInstructions } = await chrome.storage.local.get(['groqApiKey', 'userBio', 'userInstructions']);

    if (!groqApiKey) {
        console.log("GROQ API key not set. Cannot classify.");
        return;
    }

    const { source, channel, subreddit, title, content, description, comments } = data;
    const blockKey = source === 'youtube' ? channel : subreddit;

    const prompt = `
        User Bio: ${userBio || 'Not provided'}
        ${userInstructions ? `User-Specific Instructions: ${JSON.stringify(userInstructions)}` : ''}

        Content to classify:
        - Source: ${source}
        - ${source === 'youtube' ? 'Channel' : 'Subreddit'}: ${blockKey}
        - Title: ${title}
        - Content/Description: ${content || description}
        - Top 5 Comments: ${comments.join('\n')}

        Based on the user's bio and the content details, is this content primarily for entertainment? 
        Respond ONLY with a valid JSON object like this: {"entertainment": true/false}
    `;

    // =====================================================================================
    // PRODUCTION SECURITY COMMENT: DIRECT API CALLS
    // This direct call to the GROQ API is acceptable for personal use, where the user provides their own key.
    // For a public extension, you must hide your API key in a backend.
    //
    // HOW TO REFACTOR FOR PRODUCTION:
    // 1. Move this entire API call logic into a new serverless function (e.g., `POST /api/classify`).
    // 2. The extension would send the `data` object to your API.
    // 3. Your serverless function would then make the call to GROQ using your secret API key stored securely as an environment variable on the server.
    // 4. The serverless function would also handle saving the result to the Neon database.
    // 5. The function returns the final classification to the extension.
    // 6. This prevents your GROQ API key from being exposed in the extension's code.
    // =====================================================================================
    
    console.log("Sending prompt to GROQ:", prompt);

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
                temperature: 0.2,
                max_tokens: 50,
                top_p: 1,
                stream: false,
                response_format: { type: "json_object" },
                stop: null
            })
        });

        const result = await response.json();
        console.log("Received raw response from GROQ:", JSON.stringify(result, null, 2));

        if (!response.ok || result.error || !result.choices || result.choices.length === 0) {
            console.error("Invalid response from GROQ API. Full error object:", JSON.stringify(result, null, 2));
            
            if (result.error && result.error.failed_generation) {
                console.error("GROQ 'failed_generation' details:", result.error.failed_generation);
            }
            return; 
        }

        const rawContent = result.choices[0].message.content;
        console.log("Model's raw message content:", rawContent);

        let classification;
        try {
            const jsonMatch = rawContent.match(/\{.*\}/s);
            if (!jsonMatch) {
                throw new Error("No JSON object found in the model's response.");
            }
            classification = JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("Failed to parse JSON from model response. Raw content was:", rawContent, "Error:", e);
            return;
        }

        console.log("GROQ Classification:", classification);

        if (classification.entertainment === true) {
            console.log(`Classified ${blockKey} as entertainment. Blocking.`);
            await addToBlocklist(blockKey);
            // REFACTOR COMMENT: This database call should be part of your serverless function.
            // await saveToNeonDb(blockKey, 'entertainment');
            chrome.tabs.update(tabId, { url: rickrollUrl });
        } else {
            console.log(`Classified ${blockKey} as not entertainment.`);
            // REFACTOR COMMENT: This database call should also be part of your serverless function.
            // await saveToNeonDb(blockKey, 'productive');
        }

    } catch (error) {
        console.error("Error calling GROQ API:", error);
    }
}

// --- Blocklist Cache Helpers (Local Storage) ---
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
    console.log("Updated blocklist:", blocklist);
}
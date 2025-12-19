/**
 * ai-service.js - Handles all LLM and Groq-related logic
 */

// --- Keyword Map Generation (global) ---
export async function generateKeywordMaps(userBio, groqApiKey) {
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
                model: "llama-3.1-8b-instant",
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

export async function generateUserInstructions(userBio, groqApiKey) {
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

export async function classifyWithGroq(data) {
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
        console.log("TRYING TO FIGURE THIS OUT!!!");
        console.log(`${classification.entertainment}`);
        console.log(`${blockKey}`);
        return {
            entertainment: classification.entertainment,
            reasoning: classification.reasoning,
            blockKey: blockKey,
            shouldBlock: classification.entertainment === true,
            timestamp: Date.now()
        };
        // const resultForPopup = {
        //     entertainment: classification.entertainment,
        //     reasoning: classification.reasoning,
        //     key: blockKey,
        //     timestamp: Date.now()
        // };
        // chrome.storage.session.set({ [tabId]: resultForPopup });

        // if (classification.entertainment === true) {
        //     console.log(`Classified ${blockKey} as entertainment. Reason: ${classification.reasoning}. Blocking.`);
        //     await addToBlocklist(blockKey);
        //     chrome.tabs.update(tabId, { url: rickrollUrl });
        // } else {
        //     console.log(`Classified ${blockKey} as not entertainment. Reason: ${classification.reasoning}.`);
        // }

    } catch (error) {
        console.error("Error calling GROQ API:", error);
    }
}

// STRICT mode LLM gate: only checks whether content is related to productive categories
export async function classifyStrictWithGroq(data) {
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
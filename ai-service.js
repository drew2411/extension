/**
 * ai-service.js - Handles all LLM and Groq-related logic
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

async function groqRequest(groqApiKey, prompt, maxTokens = 500, temperature = 0.2, systemPrompt = null) {
    console.log(`[Groq] Requesting with prompt: "${prompt.substring(0, 1000)}"`);
    try {
        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: prompt });

        const response = await fetch(GROQ_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqApiKey}` },
            body: JSON.stringify({ model: GROQ_MODEL, messages, temperature, max_tokens: maxTokens, top_p: 1, stream: false, stop: null })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            console.error(`[Groq] Error ${response.status}:`, result.error || 'Unknown error');
            return null;
        }
        if (!result.choices?.length) {
            console.warn('[Groq] Empty response (no choices).');
            return null;
        }
        console.log(`[Groq] Success: ${result.choices[0].message.content.substring(0, 1000)}`);
        return result.choices[0].message.content;
    } catch (err) {
        console.error('[Groq] Fetch failed:', err);
        return null;
    }
}

function parseJSON(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { }
    // Try extracting a JSON object
    try { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (_) { }
    // Try extracting a JSON array
    try { const m = raw.match(/\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); } catch (_) { }
    return null;
}

// --- V4: Intent keyword generation ---

export async function evaluateIntentClarification(phrase, groqApiKey, personaContext = '', category = 'unproductive') {
    if (!groqApiKey) return null;
    if (!phrase) return { requires_scope_clarification: false, scope_question: '', assumed_identity: null, alternate_identities: [] };

    const isUnproductive = category === 'unproductive';
    const systemPrompt = `You are a Content Filtering Architect for a productivity browser extension. You resolve the meaning of user-supplied phrases and determine whether clarification is needed before generating content-matching keywords.`;

    const prompt = `Context:
- User intent: "${phrase}" (adding to ${isUnproductive ? 'UNPRODUCTIVE block' : 'PRODUCTIVE allow'} list)
- User Persona (other active intents): ${personaContext || 'None yet'}

Task 1 - Identity Resolution:
Determine the most likely meaning of "${phrase}" using the User Persona as context.
- CRITICAL: If the phrase is a person's name, a brand, or a proper noun, preserve the original name in assumed_identity (e.g. assumed_identity should be "Conan O'Brien", not "American comedian"). Add a brief descriptor only as a suffix: "Conan O'Brien — American comedian and TV host".
- If the term has multiple completely different meanings (e.g. "Java" could be programming or coffee), list them in alternate_identities. If the meaning is clear or context makes it obvious, leave alternate_identities empty.

Task 2 - Scope Check (IMPORTANT - BE VERY CONSERVATIVE):
Only set requires_scope_clarification to true if ALL of the following are true:
- The phrase is a very broad, high-volume topic (e.g. a famous celebrity, major news topic, or pop-culture franchise)
- AND it is genuinely unclear whether the user wants everything or only a specific slice
- AND the answer cannot be reasonably assumed from context

DO NOT ask if the phrase is already specific (e.g. "Python tutorials", "dark souls gameplay"). Most phrases should NOT require clarification.

If you do ask, write a short, natural question addressed directly to the user. Example for unproductive: "Do you want to block all Genshin Impact content, or just gameplay/gacha content (not tutorials)?" Example for productive: "Are you interested in all AI content, or mainly AI coding tools?"

Respond ONLY with valid JSON. No comments, no trailing commas:
{
  "assumed_identity": "full name or exact phrase + brief descriptor",
  "alternate_identities": [],
  "requires_scope_clarification": false,
  "scope_question": ""
}`;
    const raw = await groqRequest(groqApiKey, prompt, 350, 0.1, systemPrompt);
    return parseJSON(raw) || { requires_scope_clarification: false, scope_question: '', assumed_identity: null, alternate_identities: [] };
}

export async function generateIntentKeywords(phrase, clarification, category, groqApiKey, assumedIdentity = null, personaContext = '') {
    if (!groqApiKey) return null;
    if (!phrase) return [];

    const intentDirection = category === 'productive' ? 'content I want to see and allow' : 'content I want to block';
    const identityLine = assumedIdentity
        ? `Target: "${phrase}" (identified as: ${assumedIdentity})`
        : `Target: "${phrase}"`;
    const clarNote = clarification ? `Scope Constraint from user: "${clarification}"` : '';
    const personaNote = personaContext ? `Other active user intents for context (do NOT generate keywords for these): ${personaContext}` : '';

    const systemPrompt = `You are a keyword generation specialist for a productivity browser extension. Your job is to generate precise content-matching keywords for a specific target, so the extension can identify matching content on YouTube and Reddit.`;

    const prompt = `${identityLine}
Intent direction: ${intentDirection}
${clarNote}
${personaNote}

Context: These keywords will be matched against YouTube video titles, descriptions, Reddit post titles, post body text, and comments. Generate keywords that would realistically appear in that content.

Rules:
- Keywords MUST be specific to "${phrase}" — not to similar entities or adjacent topics.
- Keywords must look like real phrases found in YouTube titles or Reddit posts.
- Be specific. Good: "conan o'brien clueless gamer", "conan o'brien armenia trip". Bad: "comedian show", "late night tv".
- No trivia (age, height, net worth), no generic descriptors.
- 3 to 6 keywords max.

If the Scope Constraint asks to exclude a sub-topic and keep it in the opposite category (e.g. "except tutorials"), generate a bonus_intent for that sub-topic. Otherwise leave bonus_intents empty.

Respond ONLY with valid JSON. No comments, no trailing commas:
{
  "keywords": ["kw1", "kw2", "kw3"],
  "bonus_intents": []
}`;
    const raw = await groqRequest(groqApiKey, prompt, 400, 0.1, systemPrompt);
    const parsed = parseJSON(raw);
    if (!parsed) return { keywords: [], bonus_intents: [] };

    let keywords = Array.isArray(parsed) ? parsed : (parsed.keywords || []);
    keywords = keywords.map(k => typeof k === 'string' ? k.toLowerCase().trim() : '').filter(Boolean);

    let bonus_intents = Array.isArray(parsed.bonus_intents) ? parsed.bonus_intents : [];

    return { keywords, bonus_intents };
}

export async function analyzeDiscoveryBuffer(titles, intents, groqApiKey) {
    if (!groqApiKey || !titles?.length) return [];
    const intentList = (intents || []).map(i => `"${i.original_phrase}" (${i.category})`).join(', ') || 'None';

    const systemPrompt = `You are a content pattern analyst for a productivity browser extension. You identify recurring new themes in a user's browsing history that are not already covered by their configured intents.`;

    const prompt = `Here are ${titles.length} recent YouTube video / Reddit post titles a user visited:
${titles.slice(0, 50).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Current user intents (already covered — do NOT suggest these): ${intentList}

Are there 1-2 recurring themes in these titles that are NOT already covered by the user's intents? Only suggest genuinely distinct, recurring themes that appear multiple times.
Reply only as a JSON array: [{"theme": "short theme name", "example_titles": ["title1", "title2"]}]
If no clear new themes, reply with an empty array: []`;
    const raw = await groqRequest(groqApiKey, prompt, 400, 0.3, systemPrompt);
    const parsed = parseJSON(raw);
    return Array.isArray(parsed) ? parsed : [];
}

// --- Classification (LLM fallback) ---

function getDomain(url) {
    try { return new URL(url).hostname; } catch (e) { return ""; }
}

export async function classifyWithGroq(data, groqApiKey, productiveContent, unwantedContent, userInstructions) {
    if (!groqApiKey) return null;
    const { source, channel, subreddit, title, content, description } = data;
    const blockKey = source === 'youtube' ? channel : (source === 'reddit' ? subreddit : getDomain(data.url));

    const prompt = `You are a strict content classification assistant.

User Preferences:
- Productive Content (HIGH PRIORITY): ${productiveContent || 'Not provided'}
- Unwanted Content (BLOCK): ${unwantedContent || 'Not provided'}
- General Instructions: ${userInstructions ? JSON.stringify(userInstructions) : 'Not available'}

Content to Classify:
- Source: ${source}
- ${source === 'youtube' ? 'Channel' : (source === 'reddit' ? 'Subreddit' : 'Website')}: ${blockKey}
- Title: ${title}
- Content/Description: ${content || description || 'Not available'}

Rules:
1. If content matches Productive list → NOT entertainment (unless also in Unwanted)
2. If content matches Unwanted list → IS entertainment
3. Otherwise classify by general nature

Reply ONLY as JSON: {"reasoning": "brief explanation", "entertainment": true/false}`;

    const raw = await groqRequest(groqApiKey, prompt, 600, 0.1);
    const parsed = parseJSON(raw);
    if (!parsed) return null;
    return { entertainment: parsed.entertainment, reasoning: parsed.reasoning, blockKey, shouldBlock: parsed.entertainment === true, timestamp: Date.now() };
}

export async function classifyStrictWithGroq(data, groqApiKey, productiveContent) {
    if (!groqApiKey || !productiveContent) return null;
    const { source, channel, subreddit, title, content, description } = data;
    const blockKey = source === 'youtube' ? channel : (source === 'reddit' ? subreddit : getDomain(data.url));

    const prompt = `You are a STRICT productive-content gatekeeper.
The user's productive topics: ${productiveContent}

Content:
- Source: ${source}
- ${source === 'youtube' ? 'Channel' : (source === 'reddit' ? 'Subreddit' : 'Website')}: ${blockKey}
- Title: ${title}
- Content/Description: ${content || description || 'Not available'}

Is this content SUBSTANTIALLY about one or more productive topics above? Be conservative — if unsure, say false.
Reply ONLY as JSON: {"reasoning": "brief explanation", "productive_match": true/false}`;

    const raw = await groqRequest(groqApiKey, prompt, 400, 0.1);
    const parsed = parseJSON(raw);
    if (!parsed) return null;
    if (typeof parsed.productive_match !== 'boolean') parsed.productive_match = false;
    return parsed;
}

// --- Legacy: kept for backward compat, not used in new intent flow ---
export async function generateKeywordMaps(userBio, groqApiKey) {
    if (!userBio || (!userBio.productive && !userBio.unwanted)) return null;
    const productiveTerms = (userBio.productive || '').split(',').map(s => s.trim()).filter(Boolean);
    const unwantedTerms   = (userBio.unwanted   || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!productiveTerms.length && !unwantedTerms.length) return null;

    const prompt = `Expand these topics into keyword lists for fast local matching.
Return JSON with two maps: "productive" and "unwanted". Keys are exact user terms, values are arrays of 8-15 lowercase keywords (synonyms, slang, common names). No duplicates, no explanations.
- Productive: ${productiveTerms.join(', ') || 'None'}
- Unwanted: ${unwantedTerms.join(', ') || 'None'}
Output: {"productive": {"<term>": ["k1","k2"]}, "unwanted": {"<term>": ["k1","k2"]}}`;

    const raw = await groqRequest(groqApiKey, prompt, 1000, 0.2);
    const parsed = parseJSON(raw);
    if (!parsed) return null;

    const normalize = (m = {}) => {
        const out = {};
        Object.keys(m).forEach(term => {
            const set = new Set((m[term] || []).map(x => x.toLowerCase().trim()).filter(Boolean));
            set.add(term.toLowerCase());
            Array.from(set).forEach(val => val.split(/[^a-z0-9]+/).forEach(tok => { if (tok.length >= 3) set.add(tok); }));
            out[term.trim()] = Array.from(set);
        });
        return out;
    };
    return { productive: normalize(parsed.productive || {}), unwanted: normalize(parsed.unwanted || {}) };
}

export async function generateUserInstructions(userBio, groqApiKey) {
    if (!userBio || (!userBio.productive && !userBio.unwanted)) return null;
    const prompt = `Create personalized classification rules from these user preferences:
- Productive Content: ${userBio.productive || 'Not specified'}
- Unwanted Content: ${userBio.unwanted || 'Not specified'}

Output only valid JSON:
{"relevant_topics": ["bullet1", "..."], "entertainment_indicators": ["bullet1", "..."]}`;
    const raw = await groqRequest(groqApiKey, prompt, 300, 0.2);
    return parseJSON(raw);
}
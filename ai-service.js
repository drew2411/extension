/**
 * ai-service.js - Handles all LLM and Groq-related logic
 */

import {
    INTENT_EVAL_SYSTEM,
    getIntentEvalPrompt,
    KEYWORD_GEN_SYSTEM,
    getKeywordGenPrompt,
    DISCOVERY_SYSTEM,
    getDiscoveryPrompt,
    getClassifyPrompt,
    getClassifyStrictPrompt,
    getLegacyKeywordExpandPrompt,
    getLegacyUserInstructionsPrompt
} from './ai-prompts.js';

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

    const systemPrompt = INTENT_EVAL_SYSTEM;
    const prompt = getIntentEvalPrompt(phrase, category, personaContext);
    const raw = await groqRequest(groqApiKey, prompt, 350, 0.1, systemPrompt);
    return parseJSON(raw) || { requires_scope_clarification: false, scope_question: '', assumed_identity: null, alternate_identities: [] };
}

export async function generateIntentKeywords(phrase, clarification, category, groqApiKey, assumedIdentity = null, personaContext = '') {
    if (!groqApiKey) return null;
    if (!phrase) return [];

    const systemPrompt = KEYWORD_GEN_SYSTEM;
    const prompt = getKeywordGenPrompt(phrase, clarification, category, assumedIdentity, personaContext);
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

    const systemPrompt = DISCOVERY_SYSTEM;
    const prompt = getDiscoveryPrompt(titles, intentList);
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

    const prompt = getClassifyPrompt(source, blockKey, title, content || description, productiveContent, unwantedContent, userInstructions);
    const raw = await groqRequest(groqApiKey, prompt, 600, 0.1);
    const parsed = parseJSON(raw);
    if (!parsed) return null;
    return { entertainment: parsed.entertainment, reasoning: parsed.reasoning, blockKey, shouldBlock: parsed.entertainment === true, timestamp: Date.now() };
}

export async function classifyStrictWithGroq(data, groqApiKey, productiveContent) {
    if (!groqApiKey || !productiveContent) return null;
    const { source, channel, subreddit, title, content, description } = data;
    const blockKey = source === 'youtube' ? channel : (source === 'reddit' ? subreddit : getDomain(data.url));

    const prompt = getClassifyStrictPrompt(source, blockKey, title, content || description, productiveContent);
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

    const prompt = getLegacyKeywordExpandPrompt(productiveTerms.join(', '), unwantedTerms.join(', '));
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
    const prompt = getLegacyUserInstructionsPrompt(userBio.productive, userBio.unwanted);
    const raw = await groqRequest(groqApiKey, prompt, 300, 0.2);
    return parseJSON(raw);
}
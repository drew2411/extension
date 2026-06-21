/**
 * ai-prompts.js
 * Contains all LLM system and user prompt templates for the extension.
 */

// --- Intent Evaluation and Clarification ---
export const INTENT_EVAL_SYSTEM = `You are a Content Filtering Architect for a productivity browser extension. You resolve the meaning of user-supplied phrases and determine whether clarification is needed before generating content-matching keywords.`;

export function getIntentEvalPrompt(phrase, category, personaContext = '') {
    const isUnproductive = category === 'unproductive';
    return `Context:
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
}

// --- Keyword Generation ---
export const KEYWORD_GEN_SYSTEM = `You are an expert taxonomy, classification, and keyword expansion specialist for a focus-enhancing browser extension. Your job is to generate a list of high-density, high-recall keywords for a specific target, so the extension can identify matching content (videos, posts, discussions) on YouTube and Reddit.`;

export function getKeywordGenPrompt(phrase, clarification, category, assumedIdentity = null, personaContext = '') {
    const intentDirection = category === 'productive' ? 'content I want to see and allow' : 'content I want to block';
    const identityLine = assumedIdentity
        ? `Target: "${phrase}" (identified as: ${assumedIdentity})`
        : `Target: "${phrase}"`;
    const clarNote = clarification ? `Scope Constraint from user: "${clarification}"` : '';
    const personaNote = personaContext ? `Other active user intents for context (do NOT generate keywords for these): ${personaContext}` : '';

    return `${identityLine}
Intent direction: ${intentDirection}
${clarNote}
${personaNote}

Context: These keywords will be matched against YouTube video titles, descriptions, channel names, Reddit post titles, subreddit names, post body text, and comments. We need a broad set of highly specific keywords that will realistically appear in matching content to maximize local detection.

Rules:
- Generate 10 to 15 keywords.
- Keywords MUST be specific to "${phrase}" or its direct context.
- Keywords must be short: maximum 3 words (prefer 1-2 words). Avoid long-tail search query-like sentences (e.g. do NOT generate "how to play genshin impact", generate "genshin gameplay" instead).
- Structure the keywords using a mix of these three groups:
  1. Core Terms: Variations of the target name itself (e.g. abbreviations, parent/associated companies, common handles). E.g. "genshin", "genshin impact", "mihoyo", "hoyoverse".
  2. Jargon & Proper Nouns: Key proper nouns unique to the entity (famous characters, major systems, jargon, slang, lore terms). E.g. "paimon", "primogems", "teyvat", "wish banner", "gnosis", "archon".
  3. Short Context Phrases: Shorter, flexible combinations. E.g. "genshin build", "genshin gameplay", "genshin pull".
- Strictly avoid generic words (like "game", "video", "tutorial", "fun") unless they are combined with the entity name (e.g. "genshin video" is okay, but just "video" is bad).
- Do not include trivia (age, height, net worth).

If the Scope Constraint asks to exclude a sub-topic and keep it in the opposite category (e.g. "except tutorials"), generate a bonus_intent for that sub-topic. Otherwise leave bonus_intents empty.

Respond ONLY with valid JSON. No comments, no trailing commas:
{
  "keywords": ["kw1", "kw2", "kw3"],
  "bonus_intents": []
}`;
}

// --- Discovery Buffer Analyzer ---
export const DISCOVERY_SYSTEM = `You are a content pattern analyst for a productivity browser extension. You identify recurring new themes in a user's browsing history that are not already covered by their configured intents.`;

export function getDiscoveryPrompt(titles, intentList = 'None') {
    return `Here are ${titles.length} recent YouTube video / Reddit post titles a user visited:
${titles.slice(0, 50).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Current user intents (already covered — do NOT suggest these): ${intentList}

Are there 1-2 recurring themes in these titles that are NOT already covered by the user's intents? Only suggest genuinely distinct, recurring themes that appear multiple times.
Reply only as a JSON array: [{"theme": "short theme name", "example_titles": ["title1", "title2"]}]
If no clear new themes, reply with an empty array: []`;
}

// --- General Classifier ---
export function getClassifyPrompt(source, blockKey, title, contentOrDesc, productiveContent, unwantedContent, userInstructions) {
    return `You are a strict content classification assistant for a productivity browser extension. Your job is to classify web pages, YouTube videos, and Reddit posts to determine if they are distracting "entertainment" (unproductive) or "productive" (educational/work-related).

User Preferences:
- Productive Content (HIGH PRIORITY): ${productiveContent || 'Not provided'}
- Unwanted Content (BLOCK): ${unwantedContent || 'Not provided'}
- Custom User Rules: ${userInstructions ? JSON.stringify(userInstructions) : 'Not available'}

Content to Classify:
- Source: ${source}
- Origin (${source === 'youtube' ? 'Channel' : (source === 'reddit' ? 'Subreddit' : 'Website')} Name): ${blockKey}
- Title: ${title}
- Content/Description: ${contentOrDesc || 'Not available'}

General Instructions for Classification:
1. DEFINITIONS:
   - "Entertainment" (unproductive / block): Content designed for amusement, relaxation, distraction, or leisure. This includes:
     * Video games, gameplay, playthroughs, game teasers, gacha pulls, game reviews.
     * Comedy, memes, jokes, satire, shitposts, fan animations, and humor (even if themed around productive topics like programming jokes).
     * Pop culture, anime, cartoons, vlogs (lifestyle, setup tours, daily routines), movies, TV shows, and celebrity gossip.
     * Fiction, creative writing, sports, recreational hobbies, and general social media browsing.
   - "Productive / Utility" (allow): Content designed for active learning, work, or professional development. This includes:
     * Coding tutorials, programming guides, API documentations, software engineering lectures.
     * Scientific research, physics, mathematics, academic lectures, and historical/cultural documentaries.
     * Business, economics, finance, global geopolitical news, industry updates, and tech advancements.
     * Productivity methodologies, language learning, design/UI/UX theory, and professional skills tutorials.

2. CLASSIFICATION PROTOCOLS:
   - Check Productive Matches: If the content is an educational/tutorial resource directly teaching or discussing a topic in the "Productive Content" list, classify it as "NOT entertainment" (entertainment: false), unless it is overridden by the Unwanted list.
   - Check Unwanted Matches: If the content is about a topic in the "Unwanted Content" list, classify it as "entertainment" (entertainment: true).
   - Check for Humor and Memes: Humor, memes, jokes, and satire (e.g. "/r/programmerhumor" posts or funny compilation videos) are ALWAYS entertainment (entertainment: true), even if they mention productive topics like Python, math, or history.
   - Screen Vlogs and Lifestyle: General creator vlogs, setup showcases, "day in the life" videos, and casual conversations/podcasts without a concrete educational outline are entertainment (entertainment: true).
   - Bypass Clickbait: Clickbait or sensationalist titles (e.g., "I built X in 2 hours and hated it") should be classified based on their underlying description and context. If it is a walkthrough showing code and explaining algorithms, it is productive. If it is purely showmanship, reactions, or entertainment, it is entertainment.
   - Handle General News: Geopolitical news, technological industry updates, business reports, and scientific articles are NOT entertainment (entertainment: false).
   - Strict Default: If the content is ambiguous or contains a mix of comedy and education where the primary purpose is entertainment/amusement, default to classifying it as entertainment (entertainment: true).

Rules:
1. If content matches Productive list → NOT entertainment (unless also in Unwanted or contains humor/vlogging)
2. If content matches Unwanted list → IS entertainment
3. Otherwise classify by general nature using the General Instructions above

Reply ONLY as a valid JSON object. Do not include any markdown formatting or extra text outside the JSON block:
{
  "reasoning": "A concise, specific explanation referencing title/origin details and matching guidelines.",
  "entertainment": true/false
}`;
}

// --- Strict Classifier ---
export function getClassifyStrictPrompt(source, blockKey, title, contentOrDesc, productiveContent) {
    return `You are a STRICT productive-content gatekeeper.
The user's productive topics: ${productiveContent}

Content:
- Source: ${source}
- ${source === 'youtube' ? 'Channel' : (source === 'reddit' ? 'Subreddit' : 'Website')}: ${blockKey}
- Title: ${title}
- Content/Description: ${contentOrDesc || 'Not available'}

Is this content SUBSTANTIALLY about one or more productive topics above? Be conservative — if unsure, say false.
Reply ONLY as JSON: {"reasoning": "brief explanation", "productive_match": true/false}`;
}

// --- Legacy User Instructions & Keyword Map expansion ---
export function getLegacyKeywordExpandPrompt(productiveTermsStr, unwantedTermsStr) {
    return `Expand these topics into keyword lists for fast local matching.
Return JSON with two maps: "productive" and "unwanted". Keys are exact user terms, values are arrays of 8-15 lowercase keywords (synonyms, slang, common names). No duplicates, no explanations.
- Productive: ${productiveTermsStr || 'None'}
- Unwanted: ${unwantedTermsStr || 'None'}
Output: {"productive": {"<term>": ["k1","k2"]}, "unwanted": {"<term>": ["k1","k2"]}}`;
}

export function getLegacyUserInstructionsPrompt(productiveContent, unwantedContent) {
    return `Create personalized classification rules from these user preferences:
- Productive Content: ${productiveContent || 'Not specified'}
- Unwanted Content: ${unwantedContent || 'Not specified'}

Output only valid JSON:
{"relevant_topics": ["bullet1", "..."], "entertainment_indicators": ["bullet1", "..."]}`;
}

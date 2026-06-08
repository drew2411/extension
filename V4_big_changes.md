# AI-Powered Productivity Chrome Extension: Technical Spec & Implementation Guide

## 1. Core Architecture & Philosophy

* **Privacy-First:** No central database. All user data (watch history, intents, preferences) is stored locally using `chrome.storage.local`.
* **Bring Your Own Key (BYOK):** Users provide their own Groq API key for LLM processing, ensuring zero compute cost on your end and maximum privacy.
* **Intent-Driven, Not Keyword-Driven:** Users define concepts (Intents) in their own words. The LLM translates these into actionable, blockable keywords.
* **Stateful UI (Options Page):** The core configuration lives in a full-tab Options Page (`options.html`), not just the tiny popup, allowing for a rich, "Cell-based" interface.

---

## 2. The Data Model (The "Cell" System)

Instead of a flat array of comma-separated strings, user inputs are stored as relational **Intent Objects** (rendered as UI "Cells"). This allows for easy toggling, detailed metadata, and precise unblocking.

**Example Internal Data Structure:**

```json
{
  "intents": [
    {
      "id": "intent_001",
      "original_phrase": "NBA",
      "category": "Productive",
      "keywords": ["basketball", "lebron", "dunk", "warriors", "espn"]
    },
    {
      "id": "intent_002",
      "original_phrase": "Cavaliers",
      "category": "Unproductive",
      "keywords": ["cleveland cavaliers", "donovan mitchell"]
    },
    {
      "id": "intent_003",
      "original_phrase": "John Mayer",
      "category": "Productive",
      "keywords": ["john mayer live", "mayer guitar lesson"],
      "clarification": "Only music and guitar tutorials, no interviews."
    }
  ],
  "shadow_list": [
    {
      "url_id": "r/clevelandcavs",
      "blocked_by_intent": "intent_002",
      "timestamp": 1715240000
    }
  ]
}

```

---

## 3. Key Features & Workflows

### A. The LLM Clarification Loop (Dynamic Prompting)

When a user adds a new Intent, the system ensures the LLM understands exactly what to target to avoid false positives.

1. User types a phrase into a Cell (e.g., "John Mayer") and clicks Save.
2. **API Call 1 (Evaluation):** Extension queries Groq: *"Does the intent 'John Mayer' require clarification to know if it applies to all content, or only specific sub-topics? Reply in JSON: `{\"requires_clarification\": true/false, \"question\": \"...\"}`"*
3. **User Input:** If true, render the question directly under the Cell in the UI. (e.g., *"Just the music, or interviews too?"*)
4. **API Call 2 (Generation):** Send the original phrase + the user's clarification back to Groq to generate the final array of 5-10 specific targeting keywords.

### B. Conflict Resolution (Specificity Wins)

To handle cases where user intents overlap (e.g., "NBA" is Productive, but "Cavaliers" is Unproductive).

* **Rule:** The most specific keyword match takes precedence.
* **Execution:** When evaluating a video, check the Unproductive keyword lists first. If "Cleveland Cavaliers" (from the specific Unproductive intent) matches, block it. If it doesn't match the specific Unproductive list, evaluate against the broader Productive intent ("NBA") and allow it.

### C. The Shadow List & Instant Toggling

When an Intent is moved from Unproductive $\rightarrow$ Productive, the user should not have to manually unblock channels.

* **Logic:** Whenever a channel/URL is blocked, log it in a `shadow_list` along with the `intent_id` that triggered the block.
* **Action:** When an Intent's `category` is toggled to Productive, trigger a background script to scan the `shadow_list` and instantly whitelist any URL blocked by that specific `intent_id`.

### D. The Triple-Toggle Comment Blocker

Comments can be productive or massive time-sinks. Provide a global setting in the Extension Popup with three modes:

* **All:** Comments are universally hidden via CSS injection.
* **Productive Only:** Comments are hidden *only* on videos deemed Productive (prevents reading debates on a lecture video).
* **Unproductive Only:** Comments are hidden on borderline/allowed videos that lean toward entertainment.
* *UI Note:* Inject a clean div where the comments used to be saying: *"Comments hidden to maintain focus."*

### E. The Local Discovery Engine

A privacy-first way to suggest new categories based on implicit viewing habits.

1. **Track:** Background script silently logs the titles of visited YouTube videos / Reddit posts into a local array in `chrome.storage.local`.
2. **Batch:** Once the array reaches 50 items, trigger Groq.
3. **Analyze:** *"Here are 50 recent titles. Current intents: [List]. Are there recurring themes NOT currently classified? Suggest 1-2 new categories."*
4. **Prompt:** Clear the local array. Display a notification badge on the extension icon. The popup asks: *"You've been watching a lot of Cooking videos. Categorize as Productive or Unproductive?"*

### F. Advanced Keyword Transparency

Power users need the ability to override AI mistakes.

* **UI Implementation:** Add an "Advanced Mode" toggle in the Options page.
* **Functionality:** When enabled, every Cell expands to display the underlying JSON array of keywords generated by Groq.
* **Control:** Users can click an 'X' next to any keyword to delete it, or manually type in a new one if the LLM missed a crucial term.

---

## 4. UI/UX Structure

* **`popup.html` (The Dropdown):**
* Extension On/Off Master Switch.
* Triple-Toggle Comment Blocker setting.
* Discovery notifications (e.g., "Categorize new theme: Cooking").
* Link to Options Page.


* **`options.html` (The Dashboard):**
* **Settings Tab:** Input field for Groq API Key, Strictness Slider.
* **Intents Dashboard:** Two columns ("Productive" and "Unproductive"). Users can add Cells, drag-and-drop between columns, and interact with LLM clarification questions here.
* **Advanced Mode Toggle:** Reveals the raw keywords inside each Cell.



---

## 5. Technical Implementation Steps

1. **Initialize Extension:** Setup `manifest.json` (Manifest V3) with permissions for `storage`, `activeTab`, `scripting`, and host permissions for YouTube/Reddit.
2. **Build Options UI:** Create the React/Vanilla JS interface for the Cell system and API key storage.
3. **LLM Service:** Create a utility function to handle the fetch calls to Groq API using the stored key.
4. **Content Scripts (The Blocker):**
* Implement a "Blur-First" CSS injection. As soon as a page loads, blur the `#content` div and show a loading spinner.
* Extract the Title, Channel Name, and Description from the DOM.
* Run local Regex matching against stored keywords. (Fallback to Groq if local match is uncertain).
* Remove blur if allowed; redirect to a local `blocked.html` page if unallowed.


5. **Storage Logic:** Implement the `shadow_list` and the local batching array for the Discovery Engine.

---

## 6. Final Implemented V4 Features (Update)

While the original technical spec focused on YouTube and Reddit, the final V4 implementation dramatically expanded the scope based on real-world usage constraints:

* **Universal Website Support**: The extension now runs classification and blocking logic universally across *all* websites.
* **Instagram Specifics**: Added dedicated Instagram creator scraping and popup creator blocking controls.
* **Group Timers**: Users can now create time limits for a *group* of websites or content intents, pooling the timer across them (applicable to Homepage, Strict URL, Exact URL, and Content Timers).
* **Creator Blocklist**: Explicit background logic to support blocking specific creators completely.
* **Productive Dominance**: A scoring system (default factor 2.0) where productive elements can outweigh unproductive ones when determining final classification.
* **High-Recall Keyword Engine**: Revamped `KEYWORD_GEN_SYSTEM` to generate multi-tier, high-density short keywords.
* **Enhanced Local Match Detection**: Regex matching now supports hashtag matching, plurals, joint phrases (ignoring spaces), and automatic injection of original search phrases.
* **Strict Definitions**: The general classification prompt now uses detailed definitions for productive vs. entertainment content to heavily reduce LLM ambiguity.
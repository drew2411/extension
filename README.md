# Custom Content Blocker: Improve Productivity

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web_Store-blue.svg)](https://chromewebstore.google.com/detail/custom-content-blocker-im/dcaejdepadkidacpocpbclgplbbppnjl)
[![Version](https://img.shields.io/badge/Version-4.0-brightgreen.svg)]()

Block custom content on any site using AI intent detection. A privacy-first extension that helps you stay focused by blocking distractions while allowing productive content, driven entirely by your own defined "Intents".

[Download on the Chrome Web Store](https://chromewebstore.google.com/detail/custom-content-blocker-im/dcaejdepadkidacpocpbclgplbbppnjl)

---

## Core Philosophy

* **Privacy-First:** No central database or cloud tracking. All your data (watch history, intents, preferences) is stored locally using `chrome.storage.local`.
* **Bring Your Own Key (BYOK):** The extension uses the Groq API for LLM processing. You provide your own key, ensuring maximum privacy and zero recurring subscription costs for the core AI logic.
* **Intent-Driven, Not Keyword-Driven:** You don't need to guess exact keywords to block. Define concepts (Intents) in your own words (e.g., "NBA" or "John Mayer"), and the LLM translates these into actionable, blockable keywords automatically.

---

## Key Features

### AI-Powered "Cell" System & Clarification
Instead of a simple list of banned words, you define "Intents". When you add a new intent, the AI will ask for clarification if needed (e.g., "Do you want to block all gaming, or just gameplay videos?"). This generates a highly accurate, multi-tier list of hidden keywords.

### Universal Website Support
Runs classification and blocking logic universally across all websites, with specialized deep integrations for YouTube, Reddit, and Instagram (including dedicated creator scraping and blocking).

### Group Timers
Create time limits not just for single websites, but for a group of websites or content intents. The timer is pooled across them, giving you flexible control over your daily entertainment allowance.

### Creator Blocklist
Explicit support for blocking specific creators completely, regardless of what content they post. 

### Triple-Toggle Comment Blocker
Comments can be productive or massive time-sinks. Control them globally:
1. **All:** Comments are universally hidden.
2. **Productive Only:** Comments are hidden only on educational/productive videos.
3. **Unproductive Only:** Comments are hidden on borderline/allowed videos that lean toward entertainment.

### Local Discovery Engine
A privacy-first feature that silently analyzes your browsing history locally. When it detects recurring themes that aren't categorized yet, it prompts you to classify them as Productive or Unproductive. 

### Conflict Resolution & Productive Dominance
If intents overlap (e.g., "Programming" is productive, but a specific channel is blocked), specificity wins. Furthermore, a "Productive Dominance" scoring system ensures that educational content is accurately allowed even if it lightly touches on blocked topics.

### Advanced Keyword Transparency
For power users: enable "Advanced Mode" to see the exact JSON array of keywords the AI generated for your intents. You can manually delete mistakes or add specific terms the AI missed.

---

## How it Works

1. **Setup:** Install the extension and paste your Groq API key in the Options dashboard.
2. **Define Intents:** Create "Productive" and "Unproductive" intents in the dashboard.
3. **AI Processing:** The extension uses Groq to expand your intents into high-recall keywords.
4. **Local Matching:** As you browse, the extension runs highly optimized local Regex matching against titles, descriptions, and channel names to determine if content should be blurred and blocked, or allowed.

### The Shadow List
When you toggle an intent from Unproductive to Productive, you don't have to manually unblock things. The extension remembers what was blocked by that intent and instantly whitelists it across your active tabs.

---

## Installation & Setup

1. Install the extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/custom-content-blocker-im/dcaejdepadkidacpocpbclgplbbppnjl).
2. Get a free API key from [Groq](https://console.groq.com/keys).
3. Open the Extension Options page (click the extension icon and select the settings gear).
4. Enter your Groq API key.
5. Start adding your Productive and Unproductive intents!

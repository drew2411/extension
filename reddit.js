(function() {
    if (typeof window.runRedditAnalysis === 'function') {
        window.runRedditAnalysis();
        return;
    }

    const BLUR_FIRST_ENABLED = false;

    var ANALYSIS_DELAY = 6000;
    var lastProcessedUrl = '';

    // --- Blur overlay ---
    function showBlurOverlay() {
        if (!BLUR_FIRST_ENABLED) return null;
        if (document.getElementById('ext-focus-overlay')) return null;
        const overlay = document.createElement('div');
        overlay.id = 'ext-focus-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;transition:opacity 0.3s;';
        overlay.innerHTML = '<div style="color:#fff;font-size:15px;font-family:sans-serif;text-align:center;"><div style="font-size:28px;margin-bottom:10px;">🔍</div>Analyzing content...</div>';
        document.body.appendChild(overlay);
        return overlay;
    }

    function removeBlurOverlay() {
        const el = document.getElementById('ext-focus-overlay');
        if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }
    }

    // --- Comment blocker ---
    function applyCommentMode(commentMode, isEntertainment) {
        const shouldHide = commentMode === 'all' || (commentMode === 'productive' && !isEntertainment);
        if (!shouldHide) return;
        const selectors = ['#comments', 'div[data-testid="comments-page-layout"]', 'div[data-adclicklocation="comment_thread"]'];
        let hidden = false;
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                el.style.display = 'none';
                if (!document.getElementById('ext-comments-hidden')) {
                    const placeholder = document.createElement('div');
                    placeholder.id = 'ext-comments-hidden';
                    placeholder.style.cssText = 'padding:20px;color:#aaa;text-align:center;font-style:italic;font-family:sans-serif;font-size:14px;';
                    placeholder.textContent = 'Comments hidden to maintain focus.';
                    el.insertAdjacentElement('afterend', placeholder);
                }
                hidden = true;
                break;
            }
        }
    }

    function sendMessageWithRetry(message, retries = 3) {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                const err = chrome.runtime.lastError.message;
                if (err.includes('Receiving end does not exist') && retries > 0) {
                    setTimeout(() => sendMessageWithRetry(message, retries - 1), 5000);
                }
            }
        });
    }

    const extractData = () => {
        const url = window.location.href;
        if (url === lastProcessedUrl || !url.includes('/r/')) { removeBlurOverlay(); return; }
        lastProcessedUrl = url;

        let data = { source: 'reddit', url, comments: [] };
        data.subreddit = url.split('/r/')[1].split('/')[0];

        if (url.includes('/comments/')) {
            data.title = document.querySelector('h1')?.innerText;

            // New Shreddit layout: <shreddit-post-text-body> > div[id$="-post-rtjson-content"]
            const shredditBody = document.querySelector('shreddit-post-text-body [id$="-post-rtjson-content"]');
            // Fallback: classic Reddit layout
            const classicBody = document.querySelector('div[data-test-id="post-content"]');
            const postBody = shredditBody || classicBody;
            if (postBody) data.content = Array.from(postBody.querySelectorAll('p')).map(p => p.innerText).join('\n');

            // New Shreddit comments vs classic
            const commentPs = document.querySelectorAll('shreddit-comment p, div[data-testid="comment"] p');
            commentPs.forEach((p, i) => { if (i < 5) data.comments.push(p.innerText); });
        } else {
            data.title = `Subreddit: r/${data.subreddit}`;
            const sidebar = document.querySelector('div[data-testid="frontpage-sidebar"]');
            if (sidebar) { const desc = sidebar.querySelector('p'); data.description = desc ? desc.innerText : ''; }
            const postTitles = [];
            document.querySelectorAll('h3[id^="post-title-"]').forEach(el => postTitles.push(el.innerText));
            data.content = postTitles.join('\n');
        }

        sendMessageWithRetry({ type: 'contentData', data });

        // After sending, check for comment mode
        chrome.storage.local.get(['commentMode'], ({ commentMode }) => {
            if (!commentMode || commentMode === 'off') { removeBlurOverlay(); return; }
            chrome.runtime.sendMessage({ type: 'getClassification', tabId: null }, () => { });
            // Poll for classification result
            let polls = 0;
            const interval = setInterval(() => {
                polls++;
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (!tabs[0]) { clearInterval(interval); removeBlurOverlay(); return; }
                    chrome.runtime.sendMessage({ type: 'getClassification', tabId: tabs[0].id }, (cls) => {
                        if (cls && cls.entertainment !== undefined) {
                            clearInterval(interval);
                            applyCommentMode(commentMode, cls.entertainment);
                            removeBlurOverlay();
                        } else if (polls > 15) { clearInterval(interval); removeBlurOverlay(); }
                    });
                });
            }, 1000);
        });
    };

    window.runRedditAnalysis = () => {
        showBlurOverlay();
        setTimeout(extractData, ANALYSIS_DELAY);
    };

    window.runRedditAnalysis();
})();
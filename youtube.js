(function() {
    if (typeof window.runYoutubeAnalysis === 'function') {
        window.runYoutubeAnalysis();
        return;
    }

    const BLUR_FIRST_ENABLED = false;
    console.log('YouTube content script initialized.');

    var ANALYSIS_DELAY = 6000;
    var RETRY_DELAY = 5000;
    var MAX_RETRIES = 3;
    var DESCRIPTION_EXPAND_WAIT = 1000;
    let lastProcessedUrl = '';

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
        // Try multiple selectors for YouTube comments
        const selectors = ['#comments', 'ytd-comments'];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                el.style.display = 'none';
                if (!document.getElementById('ext-comments-hidden')) {
                    const placeholder = document.createElement('div');
                    placeholder.id = 'ext-comments-hidden';
                    placeholder.style.cssText = 'padding:32px;color:#aaa;text-align:center;font-style:italic;font-family:Roboto,sans-serif;font-size:14px;';
                    placeholder.textContent = 'Comments hidden to maintain focus.';
                    el.insertAdjacentElement('afterend', placeholder);
                }
                break;
            }
        }
    }

    function sendMessageWithRetry(message, retries = MAX_RETRIES) {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                const err = chrome.runtime.lastError.message;
                if (err.includes('Receiving end does not exist') && retries > 0) {
                    setTimeout(() => sendMessageWithRetry(message, retries - 1), RETRY_DELAY);
                } else {
                    console.error('Failed to send message:', err);
                }
            }
        });
    }

    const extractDescription = async () => {
        let videoDescription = '';
        try {
            const showMoreButton = document.querySelector('tp-yt-paper-button#expand') ||
                document.querySelector('tp-yt-paper-button#description-inline-expand-button') ||
                document.querySelector('#expand');
            if (showMoreButton && showMoreButton.offsetParent !== null) {
                showMoreButton.click();
                await new Promise(resolve => setTimeout(resolve, DESCRIPTION_EXPAND_WAIT));
            }

            // Primary: .ytAttributedStringHost wraps the visible span.ytAttributedStringLinkInheritColor
            // which is YouTube's current description container structure
            const primary = document.querySelector('#description-inline-expander .ytAttributedStringHost') ||
                document.querySelector('.ytAttributedStringHost');

            if (primary) {
                // .innerText preserves visual layout (line breaks) better than .textContent
                videoDescription = primary.innerText.trim();
            } else {
                // Fallback: older YouTube DOM used .yt-core-attributed-string
                const fallback = document.querySelector('#description-inline-expander .yt-core-attributed-string') ||
                    document.querySelector('.yt-core-attributed-string');
                if (fallback) {
                    videoDescription = fallback.innerText.trim();
                } else {
                    console.log('Description container not found — YouTube may have changed its DOM.');
                }
            }
        } catch (e) { console.error('Error extracting description:', e); }
        return videoDescription.slice(0, 300);
    };

    const extractData = async () => {
        if (window.location.href === lastProcessedUrl) { removeBlurOverlay(); return; }
        lastProcessedUrl = window.location.href;

        try {
            const titleEl = document.querySelector('h1.ytd-watch-metadata') ||
                document.querySelector('h1.title yt-formatted-string') ||
                document.querySelector('yt-formatted-string.ytd-watch-metadata');
            const videoTitle = titleEl ? titleEl.innerText.trim() : '';

            const channelEl = document.querySelector('#upload-info #channel-name a') ||
                document.querySelector('ytd-channel-name a') ||
                document.querySelector('#owner a');
            const channelName = channelEl ? channelEl.innerText.trim() : '';

            const videoDescription = await extractDescription();

            if (!channelName && !videoTitle) { console.error('Failed to extract essential data.'); removeBlurOverlay(); return; }

            const data = { source: 'youtube', channel: channelName, title: videoTitle, description: videoDescription, url: window.location.href };
            sendMessageWithRetry({ type: 'contentData', data });

            // Comment blocker: poll for classification
            chrome.storage.local.get(['commentMode'], ({ commentMode }) => {
                if (!commentMode || commentMode === 'off') { removeBlurOverlay(); return; }
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
                            } else if (polls > 20) { clearInterval(interval); removeBlurOverlay(); }
                        });
                    });
                }, 1000);
            });

        } catch (e) {
            console.error('Error during YouTube data extraction:', e);
            removeBlurOverlay();
        }
    };

    window.runYoutubeAnalysis = () => {
        showBlurOverlay();
        setTimeout(extractData, ANALYSIS_DELAY);
    };

    window.runYoutubeAnalysis();
})();
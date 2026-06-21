(function() {
    if (typeof window.runReadabilityAnalysis === 'function') {
        window.runReadabilityAnalysis();
        return;
    }

    const BLUR_FIRST_ENABLED = false;
    var ANALYSIS_DELAY = 3000;
    let lastProcessedUrl = '';

    console.log('Mozilla Readability content script initialized.');

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

    function sendMessageWithRetry(message, retries = 3) {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                const err = chrome.runtime.lastError.message;
                if (err.includes('Receiving end does not exist') && retries > 0) {
                    setTimeout(() => sendMessageWithRetry(message, retries - 1), 3000);
                }
            }
        });
    }

    function applyCommentMode(commentMode, isEntertainment, source) {
        const shouldHide = commentMode === 'all' || (commentMode === 'productive' && !isEntertainment);
        if (!shouldHide) return;

        let selectors = [];
        let placeholderId = 'ext-comments-hidden';
        let placeholderStyle = '';
        let placeholderText = 'Comments hidden to maintain focus.';

        if (source === 'youtube') {
            selectors = ['#comments', 'ytd-comments'];
            placeholderStyle = 'padding:32px;color:#aaa;text-align:center;font-style:italic;font-family:Roboto,sans-serif;font-size:14px;';
        } else if (source === 'reddit') {
            selectors = ['#comments', 'div[data-testid="comments-page-layout"]', 'div[data-adclicklocation="comment_thread"]'];
            placeholderStyle = 'padding:20px;color:#aaa;text-align:center;font-style:italic;font-family:sans-serif;font-size:14px;';
        }

        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                el.style.display = 'none';
                if (!document.getElementById(placeholderId)) {
                    const placeholder = document.createElement('div');
                    placeholder.id = placeholderId;
                    placeholder.style.cssText = placeholderStyle;
                    placeholder.textContent = placeholderText;
                    el.insertAdjacentElement('afterend', placeholder);
                }
                break;
            }
        }
    }

    const extractData = () => {
        const url = window.location.href;
        if (url === lastProcessedUrl) { removeBlurOverlay(); return; }
        lastProcessedUrl = url;

        try {
            if (typeof Readability === 'undefined') {
                console.error('Readability library is not loaded.');
                removeBlurOverlay();
                return;
            }

            const documentClone = document.cloneNode(true);
            const reader = new Readability(documentClone);
            const article = reader.parse();

            if (!article) {
                console.warn('Readability failed to parse the page.');
                removeBlurOverlay();
                return;
            }

            let source = 'web';
            if (url.includes('youtube.com/watch')) {
                source = 'youtube';
            } else if (url.includes('reddit.com/r/')) {
                source = 'reddit';
            }

            const data = {
                source: source,
                url: url,
                title: article.title || document.title || '',
                content: article.textContent ? article.textContent.trim().slice(0, 1000) : '',
                description: article.excerpt ? article.excerpt.trim().slice(0, 300) : '',
                author: article.byline || '',
                channel: source === 'youtube' ? (article.byline || '') : undefined,
                subreddit: source === 'reddit' ? url.split('/r/')[1]?.split('/')[0] : undefined
            };

            // YouTube/Reddit specific fallback scrape just in case channel/subreddit is empty
            if (source === 'youtube' && !data.channel) {
                const channelEl = document.querySelector('#upload-info #channel-name a') ||
                    document.querySelector('ytd-channel-name a') ||
                    document.querySelector('#owner a');
                data.channel = channelEl ? channelEl.innerText.trim() : '';
            }
            if (source === 'reddit' && !data.subreddit) {
                data.subreddit = url.split('/r/')[1]?.split('/')[0];
            }

            // Instagram specific author scrape fallback
            if (url.includes('instagram.com')) {
                let instagramUser = '';
                // 1. Try scraping from meta og:description or description
                const metaDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
                                 document.querySelector('meta[name="description"]')?.getAttribute('content');
                if (metaDesc) {
                    const match = metaDesc.match(/\(@([a-zA-Z0-9_\.]+)\)/);
                    if (match) instagramUser = match[1];
                }
                // 2. Try selector for header links
                if (!instagramUser) {
                    const headerLink = document.querySelector('article header a[role="link"]') ||
                                       document.querySelector('header a[href^="/"]') ||
                                       document.querySelector('article header a');
                    if (headerLink) {
                        const href = headerLink.getAttribute('href');
                        if (href) {
                            const cleanHref = href.replace(/^\/|\/$/g, '');
                            const parts = cleanHref.split('/');
                            if (parts.length === 1 && parts[0] && !['p', 'reels', 'reel', 'stories', 'explore', 'direct', 'accounts', 'developer', 'emails'].includes(parts[0])) {
                                instagramUser = parts[0];
                            }
                        }
                    }
                }
                // 3. Fallback to URL path if profile page
                if (!instagramUser) {
                    const cleanPath = window.location.pathname.replace(/^\/|\/$/g, '');
                    const parts = cleanPath.split('/');
                    if (parts[0] && !['p', 'reels', 'reel', 'stories', 'explore', 'direct', 'accounts', 'developer', 'emails'].includes(parts[0])) {
                        instagramUser = parts[0];
                    } else if (parts[0] === 'stories' && parts[1]) {
                        instagramUser = parts[1];
                    }
                }
                if (instagramUser) {
                    data.author = instagramUser;
                }
            }

            sendMessageWithRetry({ type: 'contentData', data });

            // Comment blocker check for YouTube and Reddit
            if (source === 'youtube' || source === 'reddit') {
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
                                    applyCommentMode(commentMode, cls.entertainment, source);
                                    removeBlurOverlay();
                                } else if (polls > 20) { clearInterval(interval); removeBlurOverlay(); }
                            });
                        });
                    }, 1000);
                });
            } else {
                removeBlurOverlay();
            }

        } catch (e) {
            console.error('Error during Readability extraction:', e);
            removeBlurOverlay();
        }
    };

    window.runReadabilityAnalysis = () => {
        showBlurOverlay();
        setTimeout(extractData, ANALYSIS_DELAY);
    };

    window.runReadabilityAnalysis();
})();

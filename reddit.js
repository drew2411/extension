// reddit.js
if (typeof window.runRedditAnalysis !== 'function') {
    var ANALYSIS_DELAY = 6000;
    var lastProcessedUrl = "";

    const extractData = () => {
        const url = window.location.href;
        if (url === lastProcessedUrl || !url.includes('/r/')) return;
        
        lastProcessedUrl = url;
        let data = { source: 'reddit', url, comments: [] };
        data.subreddit = url.split('/r/')[1].split('/')[0];

        // --- POST PAGE LOGIC ---
        if (url.includes('/comments/')) {
            data.title = document.querySelector('h1')?.innerText;
            const postBody = document.querySelector('div[data-test-id="post-content"]');
            if (postBody) {
                data.content = Array.from(postBody.querySelectorAll('p')).map(p => p.innerText).join('\n');
            }
            document.querySelectorAll('div[data-testid="comment"] p').forEach((p, i) => {
                if (i < 5) data.comments.push(p.innerText);
            });
        } 
        // --- SUBREDDIT HOMEPAGE LOGIC (Restored your selectors) ---
        else {
            data.title = `Subreddit: r/${data.subreddit}`;
            
            // Re-including your original description logic
            const sidebar = document.querySelector('div[data-testid="frontpage-sidebar"]');
            if (sidebar) {
                const descriptionElement = sidebar.querySelector('p');
                data.description = descriptionElement ? descriptionElement.innerText : '';
            }

            // Combine all post titles found on the feed
            let postTitles = [];
            document.querySelectorAll('h3[id^="post-title-"]').forEach(titleElement => {
                postTitles.push(titleElement.innerText);
            });
            data.content = postTitles.join('\n');
        }

        chrome.runtime.sendMessage({ type: 'contentData', data });
    };

    window.runRedditAnalysis = () => {
        setTimeout(extractData, ANALYSIS_DELAY);
    };
}

window.runRedditAnalysis();
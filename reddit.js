const extractData = () => {
    const url = window.location.href;
    let data = { source: 'reddit', comments: [] };

    if (url.includes('/r/') && url.includes('/comments/')) {
        // Post Page
        data.title = document.querySelector('h1')?.innerText;
        data.subreddit = url.split('/r/')[1].split('/')[0];
        
        const postBody = document.querySelector('div[data-test-id="post-content"]');
        if (postBody) {
            data.content = '';
            postBody.querySelectorAll('p').forEach(p => data.content += p.innerText + '\n');
            data.content = data.content.trim();
        }

        // More robust comment selector
        document.querySelectorAll('div[id^="t1_"]').forEach(commentNode => {
            if (data.comments.length < 5) {
                const commentText = commentNode.querySelector('div[data-testid="comment"] p')?.innerText;
                if (commentText) {
                    data.comments.push(commentText);
                }
            }
        });

        // Subreddit description is not easily available on post pages, so we leave it out.

    } else if (url.includes('/r/')) {
        // Subreddit Homepage
        data.subreddit = url.split('/r/')[1].split('/')[0];
        data.title = `Subreddit: r/${data.subreddit}`;

        // Extract subreddit description
        const sidebar = document.querySelector('div[data-testid="frontpage-sidebar"]');
        if (sidebar) {
            data.description = sidebar.querySelector('p')?.innerText;
        }

        // Extract post titles from the homepage
        let postTitles = [];
        document.querySelectorAll('h3[id^="post-title-"]').forEach(titleElement => {
            postTitles.push(titleElement.innerText);
        });
        data.content = postTitles.join('\n');
    }

    if (data.subreddit) {
        chrome.runtime.sendMessage({ type: 'contentData', data: data });
    } else {
        console.log("Could not extract subreddit from URL.");
    }
};

// Use MutationObserver to wait for the page to load
const observer = new MutationObserver((mutations, obs) => {
    // Look for an element that indicates the main content is loaded
    const postContent = document.querySelector('div[data-test-id="post-content"]');
    const subredditSidebar = document.querySelector('div[data-testid="frontpage-sidebar"]');
    
    if (postContent || subredditSidebar) {
        obs.disconnect(); // Stop observing once the content is found
        extractData();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});
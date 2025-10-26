console.log("Reddit content script injected.");

const extractData = () => {
    console.log("Attempting to extract data from Reddit...");
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

        document.querySelectorAll('div[id^="t1_"]').forEach(commentNode => {
            if (data.comments.length < 5) {
                const commentText = commentNode.querySelector('div[data-testid="comment"] p')?.innerText;
                if (commentText) {
                    data.comments.push(commentText);
                }
            }
        });

    } else if (url.includes('/r/')) {
        // Subreddit Homepage
        data.subreddit = url.split('/r/')[1].split('/')[0];
        data.title = `Subreddit: r/${data.subreddit}`;

        const sidebar = document.querySelector('div[data-testid="frontpage-sidebar"]');
        if (sidebar) {
            data.description = sidebar.querySelector('p')?.innerText;
        }

        let postTitles = [];
        document.querySelectorAll('h3[id^="post-title-"]').forEach(titleElement => {
            postTitles.push(titleElement.innerText);
        });
        data.content = postTitles.join('\n');
    }

    if (data.subreddit) {
        console.log("Sending data from reddit.js:", data);
        chrome.runtime.sendMessage({ type: 'contentData', data: data });
    } else {
        console.log("Could not extract subreddit from URL.");
    }
};

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'navigation-completed') {
        // Use a timeout to allow the SPA to render the new page content
        setTimeout(extractData, 2000);
    }
});

// Initial extraction for the first page load
setTimeout(extractData, 2000);
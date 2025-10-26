console.log("Reddit content script injected and running.");

const ANALYSIS_DELAY = 2000;
const RETRY_DELAY = 5000; // 5 seconds
const MAX_RETRIES = 3;

function sendMessageWithRetry(message, retries = MAX_RETRIES) {
    console.log(`Attempting to send message (retries left: ${retries}):`, message.type);
    chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message;
            if (errorMessage.includes("Receiving end does not exist") && retries > 0) {
                console.warn(`Connection to background script failed. Retrying in ${RETRY_DELAY / 1000} seconds...`);
                setTimeout(() => {
                    sendMessageWithRetry(message, retries - 1);
                }, RETRY_DELAY);
            } else {
                console.error(`Failed to send message after multiple retries: ${errorMessage}`, message);
            }
        } else {
            console.log("Message sent successfully to background script.");
        }
    });
}

const extractData = () => {
    console.log(`Attempting to extract data from Reddit URL: ${window.location.href}`);
    const url = window.location.href;
    let data = { source: 'reddit', comments: [] };

    try {
        if (url.includes('/r/') && url.includes('/comments/')) {
            // Post Page
            console.log("Extracting from a Reddit post page.");
            data.title = document.querySelector('h1')?.innerText;
            data.subreddit = url.split('/r/')[1].split('/')[0];
            
            const postBody = document.querySelector('div[data-test-id="post-content"]');
            if (postBody) {
                data.content = '';
                postBody.querySelectorAll('p').forEach(p => data.content += p.innerText + '\n');
                data.content = data.content.trim();
                console.log(`Extracted post content: ${data.content.substring(0, 100)}...`);
            } else {
                console.warn("Could not find post content body.");
            }

            document.querySelectorAll('div[data-testid="comment"] p').forEach(commentElement => {
                if (data.comments.length < 5) {
                    data.comments.push(commentElement.innerText);
                }
            });
            console.log(`Extracted ${data.comments.length} comments.`);

        } else if (url.includes('/r/')) {
            // Subreddit Homepage
            console.log("Extracting from a subreddit homepage.");
            data.subreddit = url.split('/r/')[1].split('/')[0];
            data.title = `Subreddit: r/${data.subreddit}`;

            const sidebar = document.querySelector('div[data-testid="frontpage-sidebar"]');
            if (sidebar) {
                const descriptionElement = sidebar.querySelector('p');
                data.description = descriptionElement ? descriptionElement.innerText : '';
                console.log(`Extracted subreddit description: ${data.description}`);
            }

            let postTitles = [];
            document.querySelectorAll('h3[id^="post-title-"]').forEach(titleElement => {
                postTitles.push(titleElement.innerText);
            });
            data.content = postTitles.join('\n');
            console.log(`Extracted ${postTitles.length} post titles from the homepage.`);
        }

        if (data.subreddit) {
            console.log("Successfully extracted data from reddit.js:", data);
            sendMessageWithRetry({ type: 'contentData', data: data });
        } else {
            console.log("Could not extract subreddit from URL. No data sent.");
        }
    } catch (error) {
        console.error("An error occurred during Reddit data extraction:", error);
    }
};

// Listen for messages from the background script for SPA navigations
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'navigation-completed') {
        console.log(`'navigation-completed' message received. Waiting ${ANALYSIS_DELAY}ms to extract data.`);
        setTimeout(extractData, ANALYSIS_DELAY);
    }
});

// Initial extraction for the first page load
console.log(`Initial page load. Waiting ${ANALYSIS_DELAY}ms to extract data.`);
setTimeout(extractData, ANALYSIS_DELAY);
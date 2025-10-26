console.log("YouTube content script injected and running.");

const ANALYSIS_DELAY = 6000; // 6 seconds

const extractData = () => {
    console.log("Starting YouTube data extraction...");
    try {
        const titleElement = document.querySelector('h1.ytd-watch-metadata');
        const videoTitle = titleElement ? titleElement.innerText : '';
        if (!videoTitle) console.warn("Could not find video title.");

        const channelElement = document.querySelector('#upload-info #channel-name a');
        const channelName = channelElement ? channelElement.innerText : '';
        if (!channelName) console.warn("Could not find channel name.");

        // The description can be tricky. This selector targets the formatted string within the expandable description box.
        const descriptionElement = document.querySelector('yt-formatted-string.content.style-scope.ytd-video-secondary-info-renderer');
        const videoDescription = descriptionElement ? descriptionElement.innerText : '';
        if (!videoDescription) console.warn("Could not find video description.");

        const comments = [];
        document.querySelectorAll('ytd-comment-thread-renderer').forEach((commentNode, index) => {
            if (comments.length < 5) {
                const commentText = commentNode.querySelector('#content-text')?.innerText;
                if (commentText) {
                    comments.push(commentText);
                } else {
                    console.warn(`Could not extract text from comment node ${index}.`);
                }
            }
        });
        console.log(`Extracted ${comments.length} comments.`);

        if (!channelName && !videoTitle) {
            console.error("Failed to extract essential data (channel and title). Aborting.");
            return;
        }

        const data = {
            source: 'youtube',
            channel: channelName,
            title: videoTitle,
            description: videoDescription.trim(),
            comments: comments
        };

        console.log("Successfully extracted data from youtube.js:", data);
        chrome.runtime.sendMessage({ type: 'contentData', data: data });

    } catch (error) {
        console.error('An error occurred during YouTube data extraction:', error);
        chrome.runtime.sendMessage({ type: 'error', message: 'Could not extract data from YouTube page.' });
    }
};

// Listen for messages from the background script for SPA navigations
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'navigation-completed') {
        console.log(`'navigation-completed' message received for URL: ${message.url}. Waiting ${ANALYSIS_DELAY}ms to extract data.`);
        setTimeout(extractData, ANALYSIS_DELAY);
    }
});

// Initial extraction for the first page load
console.log(`Initial page load. Waiting ${ANALYSIS_DELAY}ms to extract data.`);
setTimeout(extractData, ANALYSIS_DELAY);
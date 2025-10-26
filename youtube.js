console.log("YouTube content script injected.");

const extractData = () => {
    console.log("Attempting to extract data from YouTube...");
    try {
        const videoTitle = document.querySelector('h1.ytd-watch-metadata').innerText;
        const channelName = document.querySelector('#upload-info #channel-name a').innerText;
        
        const descriptionElement = document.querySelector('#description-inline-expander .content');
        const videoDescription = descriptionElement ? descriptionElement.innerText : '';

        const comments = [];
        document.querySelectorAll('ytd-comment-thread-renderer').forEach(commentNode => {
            if (comments.length < 5) {
                const commentText = commentNode.querySelector('#content-text')?.innerText;
                if (commentText) {
                    comments.push(commentText);
                }
            }
        });

        const data = {
            source: 'youtube',
            channel: channelName,
            title: videoTitle,
            description: videoDescription.trim(),
            comments: comments
        };

        console.log("Sending data from youtube.js:", data);
        chrome.runtime.sendMessage({ type: 'contentData', data: data });

    } catch (error) {
        console.error('Error extracting YouTube data:', error);
        chrome.runtime.sendMessage({ type: 'error', message: 'Could not extract data from YouTube page.' });
    }
};

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'navigation-completed') {
        // Use a timeout to allow the SPA to render the new page content
        setTimeout(extractData, 3000); // YouTube can be slower to load
    }
});

// Initial extraction for the first page load
setTimeout(extractData, 3000);
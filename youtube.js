console.log("YouTube content script injected/re-injected. v5");

// Check if the main function has already been defined in this context.
if (typeof window.runYoutubeAnalysis !== 'function') {
    console.log("Defining analysis functions for the first time.");

    // Define constants and helper functions only once.
    const ANALYSIS_DELAY = 6000; // 6 seconds
    const RETRY_DELAY = 5000; // 5 seconds
    const MAX_RETRIES = 3;

    // Guard to prevent multiple extractions from being triggered for the same URL
    let lastProcessedUrl = "";

    function sendMessageWithRetry(message, retries = MAX_RETRIES) {
        console.log(`Attempting to send message (retries left: ${retries}):`, message.type);
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                const errorMessage = chrome.runtime.lastError.message;
                if (errorMessage.includes("Receiving end does not exist") && retries > 0) {
                    console.warn(`Connection to background script failed. Retrying in ${RETRY_DELAY / 1000} seconds...`);
                    setTimeout(() => { sendMessageWithRetry(message, retries - 1); }, RETRY_DELAY);
                } else {
                    console.error(`Failed to send message after multiple retries: ${errorMessage}`, message);
                }
            } else {
                console.log("Message sent successfully to background script.");
            }
        });
    }

    const extractData = () => {
        if (window.location.href === lastProcessedUrl) {
            console.log("URL has already been processed recently. Skipping extraction.");
            return;
        }
        lastProcessedUrl = window.location.href;
        console.log("Starting YouTube data extraction...");

        try {
            const titleElement = document.querySelector('h1.ytd-watch-metadata');
            const videoTitle = titleElement ? titleElement.innerText : '';
            if (!videoTitle) console.warn("Could not find video title.");

            const channelElement = document.querySelector('#upload-info #channel-name a');
            const channelName = channelElement ? channelElement.innerText : '';
            if (!channelName) console.warn("Could not find channel name.");

            // ✅ Updated description extraction
            const showMoreButton = document.querySelector('tp-yt-paper-button#expand');
            if (showMoreButton) {
                showMoreButton.click();
            }

            const descriptionElement = document.querySelector('#description yt-formatted-string') 
                || document.querySelector('ytd-expander#description yt-formatted-string') 
                || document.querySelector('yt-formatted-string.content');
            
            const videoDescription = descriptionElement ? descriptionElement.innerText.trim() : '';
            if (!videoDescription) console.warn("Could not find video description.");

            const comments = [];
            document.querySelectorAll('ytd-comment-thread-renderer').forEach((commentNode) => {
                if (comments.length < 5) {
                    const commentText = commentNode.querySelector('#content-text')?.innerText;
                    if (commentText) { comments.push(commentText); }
                }
            });
            console.log(`Extracted ${comments.length} comments.`);

            if (!channelName && !videoTitle) {
                console.error("Failed to extract essential data (channel and title). Aborting message send.");
                return;
            }

            const data = {
                source: 'youtube',
                channel: channelName,
                title: videoTitle,
                description: videoDescription,
                comments: comments
            };

            console.log("Successfully extracted data. Preparing to send to background script:", data);
            sendMessageWithRetry({ type: 'contentData', data: data });

        } catch (error) {
            console.error('An error occurred during YouTube data extraction:', error);
            sendMessageWithRetry({ type: 'error', message: 'Could not extract data from YouTube page.' });
        }
    };


    // Define the main execution function and attach it to the window object.
    window.runYoutubeAnalysis = () => {
        console.log(`Analysis triggered. Waiting ${ANALYSIS_DELAY / 1000} seconds to extract data.`);
        setTimeout(extractData, ANALYSIS_DELAY);
    };
}

// Always call the main function when the script is injected.
// This ensures that on re-injection, the analysis is triggered again.
console.log("Invoking analysis trigger.");
window.runYoutubeAnalysis();
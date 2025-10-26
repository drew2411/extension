console.log("YouTube content script injected/re-injected. v4");

const ANALYSIS_DELAY = 6000; // 6 seconds
const RETRY_DELAY = 5000; // 5 seconds
const MAX_RETRIES = 3;

// A guard to ensure the script only runs once per injection.
if (window.hasContentScriptRun) {
    console.log("Content script has already run in this context. Exiting.");
} else {
    window.hasContentScriptRun = true;

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
        console.log("Starting YouTube data extraction...");

        try {
            const titleElement = document.querySelector('h1.ytd-watch-metadata');
            const videoTitle = titleElement ? titleElement.innerText : '';
            if (!videoTitle) console.warn("Could not find video title.");

            const channelElement = document.querySelector('#upload-info #channel-name a');
            const channelName = channelElement ? channelElement.innerText : '';
            if (!channelName) console.warn("Could not find channel name.");

            const descriptionElement = document.querySelector('yt-formatted-string.content.style-scope.ytd-video-secondary-info-renderer');
            const videoDescription = descriptionElement ? descriptionElement.innerText : '';
            if (!videoDescription) console.warn("Could not find video description.");

            const comments = [];
            document.querySelectorAll('ytd-comment-thread-renderer').forEach((commentNode, index) => {
                if (comments.length < 5) {
                    const commentText = commentNode.querySelector('#content-text')?.innerText;
                    if (commentText) {
                        comments.push(commentText);
                    }
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
                description: videoDescription.trim(),
                comments: comments
            };

            console.log("Successfully extracted data. Preparing to send to background script:", data);
            sendMessageWithRetry({ type: 'contentData', data: data });

        } catch (error) {
            console.error('An error occurred during YouTube data extraction:', error);
            sendMessageWithRetry({ type: 'error', message: 'Could not extract data from YouTube page.' });
        }
    };

    // Since this script is re-injected on each navigation, we just need to run it once after a delay.
    console.log(`Script injected. Waiting ${ANALYSIS_DELAY / 1000} seconds to extract data.`);
    setTimeout(extractData, ANALYSIS_DELAY);
}

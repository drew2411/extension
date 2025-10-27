console.log("YouTube content script injected/re-injected. v5");

// Check if the main function has already been defined in this context.
if (typeof window.runYoutubeAnalysis !== 'function') {
    console.log("Defining analysis functions for the first time.");

    // Define constants and helper functions only once.
    var ANALYSIS_DELAY = 6000; // 6 seconds
    var RETRY_DELAY = 5000; // 5 seconds
    var MAX_RETRIES = 3;

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

            // Try to extract full YouTube video description
            let videoDescription = '';
            try {
                // Expand the description if "Show more" exists
                const showMoreButton = document.querySelector('tp-yt-paper-button#expand, tp-yt-paper-button#description-inline-expand');
                if (showMoreButton) {
                    showMoreButton.click();
                    console.log("Clicked 'Show more' to expand full description.");
                } else {
                    console.warn("'Show more' button not found. Description might already be expanded.");
                }

                // Wait briefly for YouTube to render the expanded description (if needed)
                const descriptionContainer = document.querySelector('ytd-text-inline-expander yt-formatted-string') ||
                                             document.querySelector('#description ytd-text-inline-expander yt-formatted-string') ||
                                             document.querySelector('#description yt-formatted-string');

                if (descriptionContainer) {
                    videoDescription = descriptionContainer.innerText.trim();
                    console.log("✅ Extracted full video description:", videoDescription.slice(0, 200) + (videoDescription.length > 200 ? '...' : ''));
                } else {
                    console.warn("⚠️ Could not find video description element in the DOM.");
                }
            } catch (error) {
                console.error("❌ Error while extracting description:", error);
            }
            console.log("Final extracted description length:", videoDescription.length);


            if (!channelName && !videoTitle) {
                console.error("Failed to extract essential data (channel and title). Aborting message send.");
                return;
            }

            const data = {
                source: 'youtube',
                channel: channelName,
                title: videoTitle,
                description: videoDescription
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
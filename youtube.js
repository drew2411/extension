console.log("YouTube content script injected/re-injected. v6");

// Check if the main function has already been defined in this context.
if (typeof window.runYoutubeAnalysis !== 'function') {
    console.log("Defining analysis functions for the first time.");

    // Define constants and helper functions only once.
    var ANALYSIS_DELAY = 6000; // 6 seconds
    var RETRY_DELAY = 5000; // 5 seconds
    var MAX_RETRIES = 3;
    var DESCRIPTION_EXPAND_WAIT = 1000; // Wait 1 second after clicking "Show more"

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

    const extractDescription = async () => {
        let videoDescription = '';
        
        try {
            // First, try to find and click the "Show more" button
            const showMoreButton = document.querySelector('tp-yt-paper-button#expand') || 
                                   document.querySelector('tp-yt-paper-button#description-inline-expand-button') ||
                                   document.querySelector('#expand');
            
            if (showMoreButton && showMoreButton.offsetParent !== null) {
                console.log("Found 'Show more' button. Clicking to expand description...");
                showMoreButton.click();
                
                // Wait for YouTube to expand the description
                await new Promise(resolve => setTimeout(resolve, DESCRIPTION_EXPAND_WAIT));
            } else {
                console.log("'Show more' button not found or not visible. Description might already be expanded.");
            }

            // Try multiple selectors for the description container
            const descriptionSelectors = [
                'ytd-text-inline-expander#description-inline-expander yt-formatted-string.ytd-text-inline-expander',
                '#description-inline-expander yt-formatted-string',
                'ytd-text-inline-expander yt-formatted-string',
                '#description yt-formatted-string',
                'yt-formatted-string.ytd-text-inline-expander',
                '#description ytd-text-inline-expander'
            ];

            for (const selector of descriptionSelectors) {
                const descriptionElement = document.querySelector(selector);
                if (descriptionElement && descriptionElement.innerText) {
                    videoDescription = descriptionElement.innerText.trim();
                    console.log(`✅ Found description using selector: ${selector}`);
                    console.log(`✅ Extracted description (${videoDescription.length} chars):`, 
                                videoDescription.slice(0, 200) + (videoDescription.length > 200 ? '...' : ''));
                    break;
                }
            }

            if (!videoDescription) {
                console.warn("⚠️ Could not find video description with any selector.");
                
                // Debug: Log available description-related elements
                const allDescElements = document.querySelectorAll('[id*="description"], [class*="description"]');
                console.log(`Found ${allDescElements.length} elements with 'description' in id/class:`, 
                           Array.from(allDescElements).map(el => ({
                               tag: el.tagName,
                               id: el.id,
                               class: el.className,
                               hasText: !!el.innerText
                           })));
            }

        } catch (error) {
            console.error("❌ Error while extracting description:", error);
        }

        return videoDescription;
    };

    const extractData = async () => {
        if (window.location.href === lastProcessedUrl) {
            console.log("URL has already been processed recently. Skipping extraction.");
            return;
        }
        lastProcessedUrl = window.location.href;
        console.log("Starting YouTube data extraction...");

        try {
            const titleElement = document.querySelector('h1.ytd-watch-metadata') || 
                                document.querySelector('h1.title yt-formatted-string') ||
                                document.querySelector('yt-formatted-string.ytd-watch-metadata');
            const videoTitle = titleElement ? titleElement.innerText.trim() : '';
            if (!videoTitle) console.warn("Could not find video title.");

            const channelElement = document.querySelector('#upload-info #channel-name a') ||
                                  document.querySelector('ytd-channel-name a') ||
                                  document.querySelector('#owner a');
            const channelName = channelElement ? channelElement.innerText.trim() : '';
            if (!channelName) console.warn("Could not find channel name.");

            // Extract description using the async function
            const videoDescription = await extractDescription();
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
console.log("Invoking analysis trigger.");
window.runYoutubeAnalysis();
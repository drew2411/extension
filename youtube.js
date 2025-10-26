const extractData = () => {
    try {
        const videoTitle = document.querySelector('h1.ytd-watch-metadata').innerText;
        const channelName = document.querySelector('#upload-info #channel-name a').innerText;
        
        const descriptionElement = document.querySelector('#description-inline-expander .content');
        const videoDescription = descriptionElement ? descriptionElement.innerText : '';

        const comments = [];
        // More robust comment selector for YouTube
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

        chrome.runtime.sendMessage({ type: 'contentData', data: data });

    } catch (error) {
        console.error('Error extracting YouTube data:', error);
        chrome.runtime.sendMessage({ type: 'error', message: 'Could not extract data from YouTube page.' });
    }
};

// Use MutationObserver to wait for the page to load
const observer = new MutationObserver((mutations, obs) => {
    // Look for the video title and comments, which are usually loaded last
    const videoTitle = document.querySelector('h1.ytd-watch-metadata');
    const commentsSection = document.querySelector('#comments');

    if (videoTitle && commentsSection) {
        obs.disconnect(); // Stop observing once the content is found
        extractData();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});
document.addEventListener('DOMContentLoaded', function () {
    // This function will run when the popup is opened.
    // It finds the active tab and sends its URL to the backend.
    identifyCurrentTab();
});

async function identifyCurrentTab() {
    const sourceInfoDiv = document.getElementById('source-info');
    const detailsDiv = document.getElementById('details');
    sourceInfoDiv.textContent = 'Identifying...';
    detailsDiv.innerHTML = ''; // Clear previous details

    // Get the current active tab
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab?.url) {
        try {
            const response = await fetch('http://127.0.0.1:8000/identify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url: tab.url }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            sourceInfoDiv.textContent = `Source: ${data.source} (${data.content_type})`;

            // Render details if they exist
            if (data.details) {
                let detailsHtml = '';
                // Sanitize function to prevent basic HTML injection
                const escape = (str) => str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

                if (data.source === 'youtube') {
                    detailsHtml = `
                        <div><strong>Title:</strong> ${escape(data.details.title)}</div>
                        <div><strong>Channel:</strong> ${escape(data.details.channel_name)}</div>
                        <p class="bio">${escape(data.details.bio)}</p>
                        <h4>Top Comments:</h4>
                    `;
                } else if (data.source === 'reddit') {
                    detailsHtml = `
                        <div><strong>Title:</strong> ${escape(data.details.title)}</div>
                        <div><strong>Subreddit:</strong> ${escape(data.details.subreddit)}</div>
                        <p class="bio">${escape(data.details.post_contents) || '<i>No post content.</i>'}</p>
                        <h4>Top Comments:</h4>
                    `;
                }

                if (data.details.comments && data.details.comments.length > 0) {
                    data.details.comments.forEach(comment => {
                        detailsHtml += `
                            <div class="comment">
                                <strong>${escape(comment.author)}:</strong>
                                <div>${comment.text}</div>
                            </div>
                        `;
                    });
                } else {
                    detailsHtml += '<div>No comments found.</div>';
                }

                if (data.details.error) {
                    detailsHtml = `<div><strong>Error:</strong> ${data.details.error}</div>`;
                }
                detailsDiv.innerHTML = detailsHtml;
            }

        } catch (error) {
            console.error('Error identifying URL:', error);
            sourceInfoDiv.textContent = 'Error: Could not connect to backend.';
        }
    } else {
        sourceInfoDiv.textContent = 'Could not get URL of the current tab.';
    }
}
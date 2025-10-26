document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const classificationsList = document.getElementById('classificationsList');

    let originalProductiveContent = '';
    let originalUnwantedContent = '';

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    const groqApiKeyInput = document.getElementById('groqApiKey');
    const youtubeApiKeyInput = document.getElementById('youtubeApiKey');
    const productiveContentInput = document.getElementById('productiveContent');
    const unwantedContentInput = document.getElementById('unwantedContent');
    const saveSettingsButton = document.getElementById('saveSettings');
    const statusDiv = document.getElementById('status');

    // Load saved settings
    chrome.storage.local.get(['groqApiKey', 'youtubeApiKey', 'productiveContent', 'unwantedContent'], (result) => {
        if (result.groqApiKey) groqApiKeyInput.value = result.groqApiKey;
        if (result.youtubeApiKey) youtubeApiKeyInput.value = result.youtubeApiKey;
        if (result.productiveContent) {
            productiveContentInput.value = result.productiveContent;
            originalProductiveContent = result.productiveContent;
        }
        if (result.unwantedContent) {
            unwantedContentInput.value = result.unwantedContent;
            originalUnwantedContent = result.unwantedContent;
        }
    });

    // Save settings
    saveSettingsButton.addEventListener('click', () => {
        const groqApiKey = groqApiKeyInput.value.trim();
        const youtubeApiKey = youtubeApiKeyInput.value.trim();
        const productiveContent = productiveContentInput.value.trim();
        const unwantedContent = unwantedContentInput.value.trim();

        if (!groqApiKey) {
            statusDiv.textContent = 'GROQ API Key is required.';
            return;
        }

        chrome.storage.local.set({
            groqApiKey,
            youtubeApiKey,
            productiveContent,
            unwantedContent
        }, () => {
            statusDiv.textContent = 'Settings saved successfully!';
            console.log('Settings saved.');

            const contentChanged = productiveContent !== originalProductiveContent || unwantedContent !== originalUnwantedContent;
            if (contentChanged) {
                console.log('Productive or unwanted content changed, generating new instructions.');
                const userBio = { productive: productiveContent, unwanted: unwantedContent };
                chrome.runtime.sendMessage({ type: 'generateInstructions', userBio: userBio, groqApiKey: groqApiKey }, (response) => {
                    if (response && response.success) {
                        console.log('User instructions are being generated in the background.');
                        originalProductiveContent = productiveContent;
                        originalUnwantedContent = unwantedContent;
                    } else {
                        console.error('Failed to send message to generate instructions or background script returned an error.');
                    }
                });
            }

            setTimeout(() => {
                statusDiv.textContent = '';
            }, 3000);
        });
    });

    function renderBlocklist(list) {
        if (!classificationsList) return;
        classificationsList.innerHTML = '';
        if (!list || list.length === 0) {
            classificationsList.innerHTML = '<li>Nothing blocked yet.</li>';
            return;
        }

        list.forEach(key => {
            const li = document.createElement('li');
            li.textContent = key;
            
            const removeButton = document.createElement('button');
            removeButton.textContent = 'Remove';
            removeButton.style.marginLeft = '10px';
            removeButton.addEventListener('click', () => {
                console.log(`Requesting removal of ${key} from blocklist.`);
                chrome.runtime.sendMessage({ type: 'removeFromBlocklist', key: key }, (response) => {
                    if (response && response.success) {
                        console.log(`Successfully initiated removal of ${key}.`);
                    } else {
                        console.error(`Failed to initiate removal of ${key}.`);
                    }
                });
            });

            li.appendChild(removeButton);
            classificationsList.appendChild(li);
        });
    }

    // Initial render
    chrome.storage.local.get({blocklist: []}, (result) => {
        renderBlocklist(result.blocklist);
    });

    // Listen for changes to the blocklist
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.blocklist) {
            console.log('Blocklist changed, re-rendering.');
            renderBlocklist(changes.blocklist.newValue);
        }
    });
});

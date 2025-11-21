document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const classificationsList = document.getElementById('classificationsList');
    const classificationDiv = document.getElementById('currentPageClassification');
    const blocklistSearchInput = document.getElementById('blocklistSearch');

    let originalProductiveContent = '';
    let originalUnwantedContent = '';
    let currentBlocklist = [];
    let strictUrls = [];
    let exactUrls = [];

    // --- Tab Navigation ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // --- Classification Display ---
    function renderClassification(result) {
        if (!classificationDiv) return;
        if (!result) {
            classificationDiv.innerHTML = 'No classification available for this page.';
            return;
        }

        let html = '';
        const key = result.key ? `<em>${result.key}</em>` : 'this page';

        if (result.status === 'classifying') {
            html = `<b>Status:</b> Analyzing content for ${key}...`;
        } else {
            const isEntertainment = result.entertainment;
            html = `
                <p style="margin-top:0;"><b>Content:</b> ${key}</p>
                <p><b>Classification:</b> ${isEntertainment ? '<span style="color:red;">Entertainment</span>' : '<span style="color:green;">Not Entertainment</span>'}</p>
                <p><b>Reason:</b> ${result.reasoning || 'N/A'}</p>
            `;
        }
        classificationDiv.innerHTML = html;
    }

    function getActiveTabClassification() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                const currentTabId = tabs[0].id;
                chrome.runtime.sendMessage({ type: 'getClassification', tabId: currentTabId }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error(chrome.runtime.lastError.message);
                        classificationDiv.innerHTML = 'Could not get classification from background script.';
                    } else {
                        console.log('Received classification for current page:', response);
                        renderClassification(response);
                    }
                });
            } else {
                 classificationDiv.innerHTML = 'Could not identify the active tab.';
            }
        });
    }

    // --- Settings ---
    const groqApiKeyInput = document.getElementById('groqApiKey');
    const productiveContentInput = document.getElementById('productiveContent');
    const unwantedContentInput = document.getElementById('unwantedContent');
    const saveSettingsButton = document.getElementById('saveSettings');
    const statusDiv = document.getElementById('status');
    const openAdvancedSettingsButton = document.getElementById('openAdvancedSettings');

    chrome.storage.local.get(['groqApiKey', 'productiveContent', 'unwantedContent'], (result) => {
        if (result.groqApiKey) groqApiKeyInput.value = result.groqApiKey;
        if (result.productiveContent) {
            productiveContentInput.value = result.productiveContent;
            originalProductiveContent = result.productiveContent;
        }
        if (result.unwantedContent) {
            unwantedContentInput.value = result.unwantedContent;
            originalUnwantedContent = result.unwantedContent;
        }
    });

    if (saveSettingsButton) {
        saveSettingsButton.addEventListener('click', () => {
            const groqApiKey = groqApiKeyInput.value.trim();
            const productiveContent = productiveContentInput.value.trim();
            const unwantedContent = unwantedContentInput.value.trim();

            if (!groqApiKey) {
                statusDiv.textContent = 'GROQ API Key is required.';
                return;
            }

            chrome.storage.local.set({
                groqApiKey,
                productiveContent,
                unwantedContent
            }, () => {
                statusDiv.textContent = 'Settings saved successfully!';
                const contentChanged = productiveContent !== originalProductiveContent || unwantedContent !== originalUnwantedContent;
                if (contentChanged) {
                    chrome.runtime.sendMessage({ type: 'generateInstructions', userBio: { productive: productiveContent, unwanted: unwantedContent }, groqApiKey: groqApiKey }, (response) => {
                        if (response && response.success) {
                            console.log('User instructions are being generated in the background.');
                            originalProductiveContent = productiveContent;
                            originalUnwantedContent = unwantedContent;
                        } else {
                            console.error('Failed to send message to generate instructions.');
                        }
                    });
                }
                // Always (re)generate keyword maps on Save to ensure freshness
                chrome.runtime.sendMessage({ type: 'generateKeywordMaps', userBio: { productive: productiveContent, unwanted: unwantedContent }, groqApiKey: groqApiKey }, (response) => {
                    if (response && response.success) {
                        console.log('Keyword maps are being generated and saved.');
                    } else {
                        console.error('Failed to send message to generate keyword maps.');
                    }
                });
                setTimeout(() => { statusDiv.textContent = ''; }, 3000);
            });
        });
    }

    if (openAdvancedSettingsButton) {
        openAdvancedSettingsButton.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('advanced.html') });
        });
    }

    // --- Blocklist Display ---
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
                chrome.runtime.sendMessage({ type: 'removeFromBlocklist', key: key });
            });
            li.appendChild(removeButton);
            classificationsList.appendChild(li);
        });
    }

    function getFilteredBlocklist() {
        const query = (blocklistSearchInput && blocklistSearchInput.value || '').toLowerCase().trim();
        let list = Array.isArray(currentBlocklist) ? currentBlocklist.slice().reverse() : [];
        if (query) {
            list = list.filter(key => (key || '').toLowerCase().includes(query));
        }
        return list;
    }

    function renderBlocklistFromState() {
        renderBlocklist(getFilteredBlocklist());
    }

    chrome.storage.local.get({blocklist: []}, (result) => {
        currentBlocklist = result.blocklist || [];
        renderBlocklistFromState();
    });

    if (blocklistSearchInput) {
        blocklistSearchInput.addEventListener('input', () => {
            renderBlocklistFromState();
        });
    }

    // --- Listen for all storage changes ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.blocklist) {
            console.log('Blocklist changed, re-rendering.');
            currentBlocklist = changes.blocklist.newValue || [];
            renderBlocklistFromState();
        }
        if (namespace === 'session') {
            getActiveTabClassification(); // Re-check classification if session data changes
        }
    });

    // --- Initial Load ---
    getActiveTabClassification();
});
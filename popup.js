document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');

    let originalUserBio = '';

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            tabContents.forEach(content => {
                content.classList.remove('active');
            });

            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    const groqApiKeyInput = document.getElementById('groqApiKey');
    const youtubeApiKeyInput = document.getElementById('youtubeApiKey');
    const userBioInput = document.getElementById('userBio');
    const saveSettingsButton = document.getElementById('saveSettings');
    const statusDiv = document.getElementById('status');

    // Load saved settings
    chrome.storage.local.get(['groqApiKey', 'youtubeApiKey', 'userBio'], (result) => {
        if (result.groqApiKey) {
            groqApiKeyInput.value = result.groqApiKey;
        }
        if (result.youtubeApiKey) {
            youtubeApiKeyInput.value = result.youtubeApiKey;
        }
        if (result.userBio) {
            userBioInput.value = result.userBio;
            originalUserBio = result.userBio;
        }
    });

    // Save settings
    saveSettingsButton.addEventListener('click', () => {
        const groqApiKey = groqApiKeyInput.value.trim();
        const youtubeApiKey = youtubeApiKeyInput.value.trim();
        const userBio = userBioInput.value.trim();

        if (!groqApiKey) {
            statusDiv.textContent = 'GROQ API Key is required.';
            return;
        }

        chrome.storage.local.set({
            groqApiKey,
            youtubeApiKey,
            userBio
        }, () => {
            statusDiv.textContent = 'Settings saved successfully!';
            if (userBio !== originalUserBio) {
                chrome.runtime.sendMessage({ type: 'generateInstructions', userBio: userBio, groqApiKey: groqApiKey }, (response) => {
                    if (response.success) {
                        console.log('User instructions are being generated.');
                        originalUserBio = userBio;
                    }
                });
            }
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 3000);
        });
    });

    function renderBlocklist(list) {
        classificationsList.innerHTML = '';
        if (list.length === 0) {
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
                chrome.runtime.sendMessage({ type: 'removeFromBlocklist', key: key }, (response) => {
                    if (response.success) {
                        console.log('Removed', key);
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
            renderBlocklist(changes.blocklist.newValue);
        }
    });
});

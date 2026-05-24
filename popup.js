document.addEventListener('DOMContentLoaded', () => {
    // --- On/Off switch ---
    const enabledToggle = document.getElementById('extensionEnabled');
    const enabledLabel  = document.getElementById('enabledLabel');

    chrome.storage.local.get(['extensionEnabled'], ({ extensionEnabled }) => {
        const enabled = extensionEnabled !== false;
        enabledToggle.checked = enabled;
        enabledLabel.textContent = enabled ? 'ON' : 'OFF';
    });

    enabledToggle.addEventListener('change', () => {
        const enabled = enabledToggle.checked;
        enabledLabel.textContent = enabled ? 'ON' : 'OFF';
        chrome.storage.local.set({ extensionEnabled: enabled });
    });

    // --- Comment Mode ---
    const commentButtons = document.querySelectorAll('.comment-toggle button');
    let currentCommentMode = 'off';

    chrome.storage.local.get(['commentMode'], ({ commentMode }) => {
        currentCommentMode = commentMode || 'off';
        updateCommentUI(currentCommentMode);
    });

    commentButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            currentCommentMode = btn.dataset.mode;
            chrome.storage.local.set({ commentMode: currentCommentMode });
            updateCommentUI(currentCommentMode);
        });
    });

    function updateCommentUI(mode) {
        commentButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    }

    // --- Discovery Card ---
    const discoveryCard  = document.getElementById('discoveryCard');
    const discoveryTheme = document.getElementById('discoveryTheme');
    let pendingDiscovery = null;

    function loadDiscovery() {
        chrome.storage.local.get(['pendingDiscovery'], ({ pendingDiscovery: pd }) => {
            if (pd && pd.suggestions && pd.suggestions.length > 0) {
                pendingDiscovery = pd;
                const theme = pd.suggestions[0].theme;
                discoveryTheme.textContent = theme;
                discoveryCard.style.display = 'block';
                lucide.createIcons();
            } else {
                discoveryCard.style.display = 'none';
            }
        });
    }
    loadDiscovery();

    document.getElementById('discoveryProductive').addEventListener('click', () => handleDiscovery('productive'));
    document.getElementById('discoveryUnproductive').addEventListener('click', () => handleDiscovery('unproductive'));
    document.getElementById('discoveryDismiss').addEventListener('click', () => dismissDiscovery());

    function handleDiscovery(category) {
        if (!pendingDiscovery) return;
        const theme = pendingDiscovery.suggestions[0].theme;
        // Ask background to generate keywords and add as intent
        chrome.storage.local.get(['groqApiKey', 'intents'], ({ groqApiKey, intents }) => {
            const existingIntents = intents || [];
            chrome.runtime.sendMessage({ type: 'generateIntentKeywords', phrase: theme, clarification: null, category }, (response) => {
                const keywords = response?.keywords || [];
                const newIntent = {
                    id: `intent_${Date.now()}`,
                    original_phrase: theme,
                    category,
                    keywords,
                    clarification: null
                };
                existingIntents.push(newIntent);
                chrome.storage.local.set({ intents: existingIntents });
            });
        });
        dismissDiscovery();
    }

    function dismissDiscovery() {
        chrome.storage.local.remove('pendingDiscovery');
        chrome.action.setBadgeText({ text: '' });
        discoveryCard.style.display = 'none';
        pendingDiscovery = null;
    }

    // --- Current Page Classification ---
    const classificationDiv = document.getElementById('currentPageClassification');

    function renderClassification(result) {
        if (!result) { classificationDiv.innerHTML = '<span style="color:#64748b;font-style:italic;">No classification available for this page.</span>'; return; }
        const key = result.key ? `<b>${result.key}</b>` : 'this page';
        if (result.status === 'classifying') {
            classificationDiv.innerHTML = `<span style="color:#94a3b8;">Analyzing ${key}...</span>`;
            return;
        }
        const badge = result.entertainment
            ? (result.unrestricted
                ? '<span class="badge badge-unrestricted">Unproductive (Unrestricted)</span>'
                : '<span class="badge badge-entertainment">Entertainment</span>')
            : '<span class="badge badge-productive">Productive</span>';
        classificationDiv.innerHTML = `
            <div style="margin-bottom:4px;">${key} &nbsp;${badge}</div>
            <div style="font-size:11px;color:#64748b;margin-top:4px;">${result.reasoning || ''}</div>
        `;
    }

    function loadClassification() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            chrome.runtime.sendMessage({ type: 'getClassification', tabId: tabs[0].id }, (response) => {
                if (chrome.runtime.lastError) { classificationDiv.textContent = 'Could not fetch classification.'; return; }
                renderClassification(response);
            });
        });
    }
    loadClassification();

    // --- Blocklist ---
    let currentBlocklist = [];
    const blocklistItems  = document.getElementById('blocklistItems');
    const blocklistSearch = document.getElementById('blocklistSearch');

    function renderBlocklist() {
        const query = (blocklistSearch.value || '').toLowerCase().trim();
        let list = currentBlocklist.slice().reverse();
        if (query) list = list.filter(k => k.toLowerCase().includes(query));
        blocklistItems.innerHTML = '';
        if (list.length === 0) {
            blocklistItems.innerHTML = '<li class="empty-state">Nothing blocked yet.</li>';
            return;
        }
        list.forEach(key => {
            const li = document.createElement('li');
            li.textContent = key;
            const btn = document.createElement('button');
            btn.textContent = 'remove';
            btn.addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'removeFromBlocklist', key }); });
            li.appendChild(btn);
            blocklistItems.appendChild(li);
        });
    }

    chrome.storage.local.get({ blocklist: [] }, ({ blocklist }) => {
        currentBlocklist = blocklist;
        renderBlocklist();
    });

    blocklistSearch.addEventListener('input', renderBlocklist);

    // --- Open Settings ---
    document.getElementById('openOptions').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });

    // --- Storage Changes ---
    chrome.storage.onChanged.addListener((changes, ns) => {
        if (ns === 'local') {
            if (changes.blocklist) { currentBlocklist = changes.blocklist.newValue || []; renderBlocklist(); }
            if (changes.pendingDiscovery) loadDiscovery();
        }
        if (ns === 'session') loadClassification();
    });

    lucide.createIcons();
});
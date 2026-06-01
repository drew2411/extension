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

    function getDomain(url) {
        try { return new URL(url).hostname; } catch (e) { return ""; }
    }

    function getDomainClassification(url, classifications) {
        if (!url) return null;
        const domain = getDomain(url).toLowerCase();
        if (!domain) return null;
        const list = classifications || {};
        if (list[domain]) return list[domain];
        const keys = Object.keys(list);
        for (const key of keys) {
            if (domain.endsWith('.' + key)) {
                return list[key];
            }
        }
        return null;
    }

    function renderClassificationUI(domain, url, tabId, classification, sessionResult) {
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            classificationDiv.innerHTML = '<span style="color:#64748b;font-style:italic;">No classification available for this page.</span>';
            return;
        }

        let badgeHtml = '';
        let detailHtml = '';
        let controlsHtml = '';

        if (classification === 'productive') {
            badgeHtml = '<span class="badge badge-productive">Productive</span>';
            detailHtml = '<div style="font-size:11px;color:#64748b;margin-top:4px;">Productive Website (Bypassed)</div>';
        } else if (classification === 'unproductive') {
            badgeHtml = '<span class="badge badge-unproductive">Unproductive</span>';
            detailHtml = '<div style="font-size:11px;color:#64748b;margin-top:4px;">Unproductive Website (Timers Enabled)</div>';
        } else if (classification === 'depends') {
            badgeHtml = '<span class="badge badge-depends">Depends on Content</span>';
            if (sessionResult) {
                if (sessionResult.status === 'classifying') {
                    detailHtml = `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">Analyzing page content...</div>`;
                } else {
                    const contentBadge = sessionResult.entertainment
                        ? (sessionResult.unrestricted
                            ? '<span class="badge badge-unrestricted">Unproductive (Unrestricted)</span>'
                            : '<span class="badge badge-entertainment">Entertainment</span>')
                        : '<span class="badge badge-productive">Productive</span>';
                    detailHtml = `
                        <div style="font-size:11px;color:#e5e7eb;margin-top:4px;">Page analysis: ${contentBadge}</div>
                        <div style="font-size:10px;color:#64748b;margin-top:2px;">${sessionResult.reasoning || ''}</div>
                    `;
                }
            } else {
                detailHtml = '<div style="font-size:11px;color:#64748b;margin-top:4px;">Pending page classification.</div>';
            }
        } else {
            badgeHtml = '<span class="badge badge-uncategorized">Uncategorized</span>';
            detailHtml = '<div style="font-size:11px;color:#64748b;margin-top:4px;">Allowed by default, tracking usage time.</div>';
        }

        if (classification === null) {
            // Render nice, big opt-in buttons
            controlsHtml = `
                <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
                    <span style="font-size:10px; text-transform:uppercase; color:#94a3b8; font-weight:600; letter-spacing:0.05em;">Categorize this site:</span>
                    <div style="display:flex; gap:6px; margin-top:2px;">
                        <button class="btn-select-cat" data-category="productive" style="flex:1; padding:6px 4px; font-size:10px; font-weight:600; cursor:pointer; border-radius:6px; border:none; background:#16a34a; color:#fff;">Productive</button>
                        <button class="btn-select-cat" data-category="unproductive" style="flex:1; padding:6px 4px; font-size:10px; font-weight:600; cursor:pointer; border-radius:6px; border:none; background:#dc2626; color:#fff;">Unproductive</button>
                        <button class="btn-select-cat" data-category="depends" style="flex:1; padding:6px 4px; font-size:10px; font-weight:600; cursor:pointer; border-radius:6px; border:none; background:#fb923c; color:#fff;">Depends</button>
                    </div>
                </div>
            `;
        } else {
            // Render smaller modify row
            const getBtnStyle = (active, color) => {
                if (active) {
                    return `background: ${color}; color: #fff; border: 1px solid ${color};`;
                }
                return `background: transparent; color: #64748b; border: 1px solid rgba(148,163,184,0.2);`;
            };

            controlsHtml = `
                <div style="margin-top:10px; border-top:1px solid rgba(148,163,184,0.1); padding-top:8px; display:flex; flex-direction:column; gap:4px;">
                    <span style="font-size:9px; text-transform:uppercase; color:#64748b; font-weight:600; letter-spacing:0.05em;">Change Category:</span>
                    <div style="display:flex; gap:4px; margin-top:2px;">
                        <button class="btn-change-cat" data-category="productive" style="flex:1; padding:4px 2px; font-size:9px; font-weight:600; cursor:pointer; border-radius:4px; ${getBtnStyle(classification === 'productive', '#16a34a')}">Prod</button>
                        <button class="btn-change-cat" data-category="unproductive" style="flex:1; padding:4px 2px; font-size:9px; font-weight:600; cursor:pointer; border-radius:4px; ${getBtnStyle(classification === 'unproductive', '#dc2626')}">Unprod</button>
                        <button class="btn-change-cat" data-category="depends" style="flex:1; padding:4px 2px; font-size:9px; font-weight:600; cursor:pointer; border-radius:4px; ${getBtnStyle(classification === 'depends', '#fb923c')}">Depends</button>
                        <button class="btn-change-cat" data-category="remove" style="flex:1; padding:4px 2px; font-size:9px; font-weight:600; cursor:pointer; border-radius:4px; background:transparent; color:#94a3b8; border:1px solid rgba(148,163,184,0.2);">Remove</button>
                    </div>
                </div>
            `;
        }

        classificationDiv.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                <span style="font-weight:600; color:#e5e7eb; word-break:break-all; margin-right:8px;">${domain}</span>
                ${badgeHtml}
            </div>
            ${detailHtml}
            ${controlsHtml}
        `;

        // Wire event listeners for category selection
        classificationDiv.querySelectorAll('.btn-select-cat, .btn-change-cat').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetCategory = btn.dataset.category;
                chrome.storage.local.get({ domainClassifications: {} }, ({ domainClassifications }) => {
                    const updated = { ...domainClassifications };
                    if (targetCategory === 'remove') {
                        delete updated[domain];
                    } else {
                        updated[domain] = targetCategory;
                    }
                    chrome.storage.local.set({ domainClassifications: updated }, () => {
                        // Notify background worker to immediately reevaluate this tab
                        chrome.runtime.sendMessage({ type: 'reEvaluateTab', tabId }, () => {
                            // Redraw UI
                            loadClassification();
                        });
                    });
                });
            });
        });
    }

    function loadClassification() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            const tabId = tabs[0].id;
            const url = tabs[0].url;
            if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                classificationDiv.innerHTML = '<span style="color:#64748b;font-style:italic;">No classification available for this page.</span>';
                return;
            }

            chrome.storage.local.get(['domainClassifications'], ({ domainClassifications }) => {
                const domain = getDomain(url);
                const classification = getDomainClassification(url, domainClassifications);

                chrome.runtime.sendMessage({ type: 'getClassification', tabId }, (sessionResult) => {
                    renderClassificationUI(domain, url, tabId, classification, sessionResult);
                });
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
            if (changes.domainClassifications) loadClassification();
        }
        if (ns === 'session') loadClassification();
    });

    lucide.createIcons();
});
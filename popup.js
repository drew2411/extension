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

    // --- Active Timers Render ---
    const activeTimersSection = document.getElementById('activeTimersSection');
    const activeTimersList = document.getElementById('activeTimersList');

    function formatTimeRemaining(secs) {
        if (secs <= 0) return '00:00';
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function urlMatchesStrictRule(url, rule) {
        if (!url || !rule) return false;
        const trimmed = rule.trim();
        if (!trimmed) return false;
        try {
            const current = new URL(url);
            if (/^https?:\/\//i.test(trimmed)) return url.startsWith(trimmed);
            const lowerRule = trimmed.toLowerCase();
            const firstSlash = lowerRule.indexOf('/');
            if (firstSlash === -1) {
                const host = current.hostname.toLowerCase();
                return host === lowerRule || host.endsWith('.' + lowerRule);
            }
            const hostPart = lowerRule.slice(0, firstSlash);
            const pathPart = lowerRule.slice(firstSlash);
            const host = current.hostname.toLowerCase();
            return (host === hostPart || host.endsWith('.' + hostPart)) && current.pathname.startsWith(pathPart);
        } catch (e) { return url.startsWith(trimmed); }
    }

    function urlMatchesHomepageRule(url, rule) {
        if (!url || !rule) return false;
        try {
            const parsedUrl = new URL(url);
            const host = parsedUrl.hostname.toLowerCase();
            const path = parsedUrl.pathname.toLowerCase().replace(/\/$/, '');
            
            let cleanRule = rule.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
            
            if (cleanRule.includes('/')) {
                const firstSlash = cleanRule.indexOf('/');
                const ruleHost = cleanRule.substring(0, firstSlash);
                const rulePath = cleanRule.substring(firstSlash).replace(/\/$/, '');
                
                const hostMatch = host === ruleHost || host.endsWith('.' + ruleHost);
                if (!hostMatch) return false;
                
                return path === rulePath || path.startsWith(rulePath + '/');
            } else {
                const hostMatch = host === cleanRule || host.endsWith('.' + cleanRule);
                if (!hostMatch) return false;
                
                if (path === '' || path === '/') return true;
                
                const commonHomePaths = [
                    '/feed', '/home', '/feed/', '/home/', '/index.html', '/index.php'
                ];
                return commonHomePaths.includes(path);
            }
        } catch (e) { return false; }
    }

    function findTimerForDomain(domain, timers) {
        if (!domain) return 'web';
        for (const key of Object.keys(timers)) {
            if (key === 'web' || key === 'overall') continue;
            const timer = timers[key];
            if (Array.isArray(timer.domains)) {
                for (const d of timer.domains) {
                    if (domain === d || domain.endsWith('.' + d)) {
                        if (Array.isArray(timer.excludedDomains)) {
                            const isExcluded = timer.excludedDomains.some(ed => domain === ed || domain.endsWith('.' + ed));
                            if (isExcluded) continue;
                        }
                        return timer.id;
                    }
                }
            }
        }
        const webTimer = timers['web'];
        if (webTimer) {
            if (Array.isArray(webTimer.excludedDomains)) {
                const isExcluded = webTimer.excludedDomains.some(ed => domain === ed || domain.endsWith('.' + ed));
                if (isExcluded) return null;
            }
            return 'web';
        }
        return null;
    }

    function updatePopupTimers() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            const tabId = tabs[0].id;
            const url = tabs[0].url;
            if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                activeTimersSection.style.display = 'none';
                return;
            }

            chrome.storage.local.get([
                'domainClassifications',
                'unproductiveTimers',
                'homepageBlocklist',
                'strictUrlBlocklist'
            ], (localData) => {
                chrome.storage.session.get([
                    tabId.toString(),
                    'activeSession',
                    'unproductiveSession'
                ], (sessionData) => {
                    const sessionResult = sessionData[tabId];
                    const domainClassifications = localData.domainClassifications || {};
                    const unproductiveTimers = localData.unproductiveTimers || {};
                    const homepageBlocklist = localData.homepageBlocklist || [];
                    const strictUrlBlocklist = localData.strictUrlBlocklist || [];
                    
                    const activeSession = sessionData.activeSession;
                    const unproductiveSession = sessionData.unproductiveSession;

                    // Match all applicable timers
                    const matched = [];
                    const domain = getDomain(url);
                    if (!domain) {
                        activeTimersSection.style.display = 'none';
                        return;
                    }

                    // 1. Strict URL timers
                    if (Array.isArray(strictUrlBlocklist)) {
                        const strict = strictUrlBlocklist.find(item => urlMatchesStrictRule(url, item.url) && item.limitMinutes >= 0);
                        if (strict) {
                            matched.push({
                                type: 'strict',
                                name: 'Blocklist Timer',
                                subText: strict.url,
                                limitMinutes: strict.limitMinutes,
                                secondsUsedToday: strict.secondsUsedToday
                            });
                        }
                    }

                    // 2. Homepage timers
                    if (Array.isArray(homepageBlocklist)) {
                        const home = homepageBlocklist.find(item => urlMatchesHomepageRule(url, item.domain) && item.limitMinutes >= 0);
                        if (home) {
                            matched.push({
                                type: 'homepage',
                                name: 'Homepage Timer',
                                subText: home.domain,
                                limitMinutes: home.limitMinutes,
                                secondsUsedToday: home.secondsUsedToday
                            });
                        }
                    }

                    // 3. Content timers
                    const classification = getDomainClassification(url, domainClassifications);
                    let contentTimerApplies = false;
                    if (classification === 'unproductive') {
                        contentTimerApplies = true;
                    } else if (classification === 'depends' && sessionResult && sessionResult.entertainment) {
                        contentTimerApplies = true;
                    }

                    if (contentTimerApplies && unproductiveTimers) {
                        const timerId = findTimerForDomain(domain, unproductiveTimers);
                        if (timerId && unproductiveTimers[timerId] && unproductiveTimers[timerId].limitMinutes >= 0) {
                            const timer = unproductiveTimers[timerId];
                            matched.push({
                                type: 'content',
                                name: `${timer.name} Content`,
                                subText: timer.domains ? timer.domains.join(', ') : '',
                                limitMinutes: timer.limitMinutes,
                                secondsUsedToday: timer.secondsUsedToday
                            });
                        }
                        if (unproductiveTimers.overall && unproductiveTimers.overall.limitMinutes >= 0) {
                            const overall = unproductiveTimers.overall;
                            matched.push({
                                type: 'overall',
                                name: 'Overall Limit',
                                subText: 'Sum of all content timers',
                                limitMinutes: overall.limitMinutes,
                                secondsUsedToday: overall.secondsUsedToday
                            });
                        }
                    }

                    if (matched.length === 0) {
                        activeTimersSection.style.display = 'none';
                        return;
                    }

                    // Calculate elapsed real-time seconds
                    const elapsedActive = (activeSession && activeSession.tabId === tabId)
                        ? Math.max(0, Math.floor((Date.now() - activeSession.startTime) / 1000))
                        : 0;

                    const elapsedUnproductive = (unproductiveSession && unproductiveSession.tabId === tabId)
                        ? Math.max(0, Math.floor((Date.now() - unproductiveSession.startTime) / 1000))
                        : 0;

                    activeTimersSection.style.display = 'block';
                    activeTimersList.innerHTML = '';

                    matched.forEach(timer => {
                        let used = timer.secondsUsedToday;
                        if (timer.type === 'strict' || timer.type === 'homepage') {
                            used += elapsedActive;
                        } else if (timer.type === 'content' || timer.type === 'overall') {
                            used += elapsedUnproductive;
                        }

                        const total = timer.limitMinutes * 60;
                        const remaining = Math.max(0, total - used);
                        const pct = (remaining / total) * 100;
                        const circum = 100.53;
                        const offset = circum - (pct / 100) * circum;

                        // Warn color if remaining is <= 2 minutes (120 seconds)
                        const color = remaining <= 120 ? '#EF5350' : '#FF4081';

                        const div = document.createElement('div');
                        div.className = 'timer-container';
                        div.innerHTML = `
                            <div class="timer-circle-box">
                                <svg width="36" height="36" viewBox="0 0 36 36">
                                    <circle class="timer-circle-bg" cx="18" cy="18" r="16"></circle>
                                    <circle class="timer-circle-progress" cx="18" cy="18" r="16"
                                        style="stroke-dasharray:${circum}; stroke-dashoffset:${offset.toFixed(2)}; stroke:${color};"></circle>
                                </svg>
                            </div>
                            <div class="timer-info">
                                <span class="timer-label" style="color:${color};">${timer.name}</span>
                                <span style="font-size:10px; color:#64748b; font-weight:500;">${timer.subText || ''}</span>
                            </div>
                            <span class="timer-value">${formatTimeRemaining(remaining)}</span>
                        `;
                        activeTimersList.appendChild(div);
                    });
                });
            });
        });
    }

    updatePopupTimers();
    const timerIntervalId = setInterval(updatePopupTimers, 1000);

    // --- Storage Changes ---
    chrome.storage.onChanged.addListener((changes, ns) => {
        if (ns === 'local') {
            if (changes.blocklist) { currentBlocklist = changes.blocklist.newValue || []; renderBlocklist(); }
            if (changes.pendingDiscovery) loadDiscovery();
            if (changes.domainClassifications) loadClassification();
            if (changes.unproductiveTimers || changes.homepageBlocklist || changes.strictUrlBlocklist) {
                updatePopupTimers();
            }
        }
        if (ns === 'session') {
            loadClassification();
            updatePopupTimers();
        }
    });

    lucide.createIcons();
});
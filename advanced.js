// advanced.js

document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const modeRadios = document.querySelectorAll('input[name="mode"]');
    const modeDescription = document.getElementById('modeDescription');
    const homepageListContainer = document.getElementById('homepageListContainer');
    const newHomepageDomainInput = document.getElementById('newHomepageDomain');
    const newHomepageLimitInput = document.getElementById('newHomepageLimit');
    const addHomepageBtn = document.getElementById('addHomepageBtn');
    const newHomepageStatusEl = document.getElementById('newHomepageStatus');
    const heuristicDominanceRatioInput = document.getElementById('heuristicDominanceRatio');
    const actionRadios = document.querySelectorAll('input[name="blockAction"]');
    const strictUrlInput = document.getElementById('strictUrlInput');
    const strictUrlLimitInput = document.getElementById('strictUrlLimit');
    const addStrictUrlButton = document.getElementById('addStrictUrl');
    const strictUrlList = document.getElementById('strictUrlList');
    const exactUrlInput = document.getElementById('exactUrlInput');
    const addExactUrlButton = document.getElementById('addExactUrl');
    const exactUrlList = document.getElementById('exactUrlList');

    // Content Timer elements
    const listContainer = document.getElementById('timersListContainer');
    const newNameInput = document.getElementById('newTimerName');
    const newDomainsInput = document.getElementById('newTimerDomains');
    const newExclusionsInput = document.getElementById('newTimerExclusions');
    const newLimitInput = document.getElementById('newTimerLimit');
    const addBtn = document.getElementById('addCustomTimerBtn');
    const statusEl = document.getElementById('newTimerStatus');

    const useMozillaForYoutubeInput = document.getElementById('useMozillaForYoutube');
    const useMozillaForRedditInput = document.getElementById('useMozillaForReddit');

    // Tab Logic
    const menuItems = document.querySelectorAll('.menu-item');
    const tabSections = document.querySelectorAll('.tab-section');

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.getAttribute('data-tab');
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');
            tabSections.forEach(section => {
                section.classList.remove('active');
                if (section.id === `tab-${tabId}`) {
                    section.classList.add('active');
                }
            });
        });
    });

    // Data State
    let homepageBlocklist = [];
    let strictUrlBlocklist = [];
    let exactUrlBlocklist = [];

    // Initial Load
    chrome.storage.local.get([
        'blockingMode',
        'homepageBlocklist',
        'strictUrlBlocklist',
        'exactUrlBlocklist',
        'heuristicDominanceRatio',
        'blockAction',
        'unproductiveTimers',
        'useMozillaForYoutube',
        'useMozillaForReddit'
    ], (result) => {
        // Mode
        const rawMode = result.blockingMode;
        const mode = (rawMode === 'STRICT' || rawMode === 'STRICTEST') ? 'STRICT' : 'LENIENT';
        if (modeRadios) {
            modeRadios.forEach(radio => radio.checked = (radio.value === mode));
        }
        updateModeDescriptionUI(mode);

        // Block Action
        const blockAction = result.blockAction || (mode === 'STRICT' ? 'RICKROLL' : 'GREYSCALE');
        if (actionRadios) {
            actionRadios.forEach(radio => radio.checked = (radio.value === blockAction));
        }

        // Homepage Limits
        homepageBlocklist = result.homepageBlocklist || [
            { domain: 'youtube.com', limitMinutes: -1, secondsUsedToday: 0 },
            { domain: 'reddit.com', limitMinutes: -1, secondsUsedToday: 0 }
        ];
        renderHomepageListUI(homepageBlocklist);

        // Ratio
        const ratio = typeof result.heuristicDominanceRatio === 'number' ? result.heuristicDominanceRatio : 2.0;
        if (heuristicDominanceRatioInput) heuristicDominanceRatioInput.value = ratio;

        // URL Lists
        strictUrlBlocklist = Array.isArray(result.strictUrlBlocklist) ? result.strictUrlBlocklist : [];
        strictUrlBlocklist = strictUrlBlocklist.map(item => {
            if (typeof item === 'string') return { url: item, limitMinutes: 0, secondsUsedToday: 0 };
            return item;
        });

        exactUrlBlocklist = Array.isArray(result.exactUrlBlocklist) ? result.exactUrlBlocklist : [];

        renderStrictUrls(strictUrlBlocklist);
        renderExactUrls(exactUrlBlocklist);

        // Unproductive timers
        const timers = result.unproductiveTimers || {
            youtube: { id: 'youtube', name: 'YouTube', domains: ['youtube.com', 'youtu.be'], limitMinutes: 0, secondsUsedToday: 0 },
            reddit: { id: 'reddit', name: 'Reddit', domains: ['reddit.com'], limitMinutes: 0, secondsUsedToday: 0 },
            web: { id: 'web', name: 'Other Websites', domains: ['*'], limitMinutes: 0, secondsUsedToday: 0 }
        };
        renderTimerListUI(timers);

        // Readability options
        if (useMozillaForYoutubeInput) {
            useMozillaForYoutubeInput.checked = !!result.useMozillaForYoutube;
        }
        if (useMozillaForRedditInput) {
            useMozillaForRedditInput.checked = !!result.useMozillaForReddit;
        }
    });

    // UI Helpers
    function updateModeDescriptionUI(mode) {
        if (!modeDescription) return;
        if (mode === 'STRICT') {
            modeDescription.textContent = 'STRICT - only explicitly productive content';
        } else {
            modeDescription.textContent = 'LENIENT - more generally deemed productive content';
        }
    }

    function formatTimeRemaining(seconds) {
        if (seconds <= 0) return "00:00:00";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
    }

    function applyRemoveButtonStyles(button) {
        button.addEventListener('mouseover', () => { button.style.color = '#FF4081'; });
        button.addEventListener('mouseout', () => { button.style.color = '#94a3b8'; });
    }

    // Unproductive timer usage display
    function formatMinSec(totalSeconds) {
        if (!totalSeconds || totalSeconds < 1) return '0m';
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    function renderHomepageListUI(list) {
        homepageBlocklist = list;
        if (!homepageListContainer) return;
        homepageListContainer.innerHTML = '';

        list.forEach((item) => {
            const div = document.createElement('div');
            div.style.cssText = 'background: rgba(15, 23, 42, 0.3); padding: 14px 16px; border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.1); margin-bottom: 12px;';

            const headerRow = document.createElement('div');
            headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

            const leftSide = document.createElement('div');
            leftSide.style.cssText = 'display: flex; flex-direction: column;';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = item.domain;
            nameSpan.style.cssText = 'font-weight: 500; color: #fff;';
            leftSide.appendChild(nameSpan);

            const rightSide = document.createElement('div');
            rightSide.style.cssText = 'display: flex; align-items: center; gap: 8px;';

            const limitInput = document.createElement('input');
            limitInput.type = 'number';
            limitInput.min = '-1';
            limitInput.value = item.limitMinutes >= 0 ? item.limitMinutes : '';
            limitInput.placeholder = 'Min';
            limitInput.style.cssText = 'width: 70px; margin-top: 0; padding: 6px 10px;';

            limitInput.addEventListener('change', () => {
                const val = parseInt(limitInput.value);
                item.limitMinutes = isNaN(val) ? -1 : val;
                chrome.storage.local.set({ homepageBlocklist }, () => {
                    renderHomepageListUI(homepageBlocklist);
                });
            });

            rightSide.appendChild(limitInput);

            const minLabel = document.createElement('small');
            minLabel.textContent = 'min/day';
            minLabel.style.marginTop = '0';
            rightSide.appendChild(minLabel);

            const isDefault = ['youtube.com', 'reddit.com'].includes(item.domain.toLowerCase());
            if (!isDefault) {
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.style.cssText = 'margin-top: 0; margin-left: 8px; padding: 4px 8px; font-size: 11px; background-color: transparent; color: #94a3b8; box-shadow: none; text-transform: lowercase;';
                applyRemoveButtonStyles(removeBtn);
                removeBtn.addEventListener('click', () => {
                    homepageBlocklist = homepageBlocklist.filter(h => h.domain !== item.domain);
                    chrome.storage.local.set({ homepageBlocklist }, () => {
                        renderHomepageListUI(homepageBlocklist);
                    });
                });
                rightSide.appendChild(removeBtn);
            }

            headerRow.appendChild(leftSide);
            headerRow.appendChild(rightSide);
            div.appendChild(headerRow);

            const usageRow = document.createElement('div');
            usageRow.style.cssText = 'margin-top: 8px;';

            const usageTextDiv = document.createElement('div');
            usageTextDiv.style.cssText = 'display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-bottom: 4px;';

            const usedText = document.createElement('span');
            usedText.textContent = `${formatMinSec(item.secondsUsedToday)} used`;

            const limitText = document.createElement('span');
            limitText.textContent = item.limitMinutes < 0 ? 'No limit set' : item.limitMinutes === 0 ? 'Always block' : `${item.limitMinutes}m/day limit`;

            usageTextDiv.appendChild(usedText);
            usageTextDiv.appendChild(limitText);
            usageRow.appendChild(usageTextDiv);

            const usageTrack = document.createElement('div');
            usageTrack.style.cssText = 'height: 6px; background: rgba(15, 23, 42, 0.5); border-radius: 3px; overflow: hidden;';

            const usageFill = document.createElement('div');
            usageFill.style.cssText = 'height: 100%; width: 0%; border-radius: 3px; transition: width 0.3s;';

            const pct = item.limitMinutes > 0 ? Math.min((item.secondsUsedToday / (item.limitMinutes * 60)) * 100, 100) : 0;
            usageFill.style.width = `${pct}%`;

            let color = '#66BB6A'; // Green for custom
            if (item.domain === 'youtube.com') color = '#FF4081';
            else if (item.domain === 'reddit.com') color = '#42A5F5';

            usageFill.style.background = pct >= 100 ? '#EF5350' : color;

            usageTrack.appendChild(usageFill);
            usageRow.appendChild(usageTrack);
            div.appendChild(usageRow);

            homepageListContainer.appendChild(div);
        });
    }

    function renderTimerListUI(timers) {
        if (!listContainer) return;
        listContainer.innerHTML = '';

        // Ensure overall exists
        if (!timers.overall) {
            timers.overall = { id: 'overall', name: 'Overall Limit', domains: [], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0, isOverall: true };
        }

        const keys = Object.keys(timers);
        const orderedKeys = [];
        if (keys.includes('overall')) orderedKeys.push('overall');
        if (keys.includes('youtube')) orderedKeys.push('youtube');
        if (keys.includes('reddit')) orderedKeys.push('reddit');
        keys.forEach(k => {
            if (k !== 'overall' && k !== 'youtube' && k !== 'reddit' && k !== 'web') orderedKeys.push(k);
        });
        if (keys.includes('web')) orderedKeys.push('web');

        orderedKeys.forEach(key => {
            const timer = timers[key];
            if (!timer) return;

            const div = document.createElement('div');
            div.style.cssText = 'background: rgba(15, 23, 42, 0.3); padding: 14px 16px; border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.1); margin-bottom: 12px;';

            const isFixed = ['youtube', 'reddit', 'web', 'overall'].includes(timer.id);

            const headerRow = document.createElement('div');
            headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

            const leftSide = document.createElement('div');
            leftSide.style.cssText = 'display: flex; flex-direction: column;';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = timer.name;
            nameSpan.style.cssText = 'font-weight: 500; color: #fff;';
            leftSide.appendChild(nameSpan);

            if (timer.id === 'overall') {
                const domainsSpan = document.createElement('small');
                domainsSpan.textContent = 'Sum of all website timers';
                domainsSpan.style.cssText = 'color:#FF4081; font-size:11px; margin-top:2px; display:block; font-weight: 500;';
                leftSide.appendChild(domainsSpan);
            } else if (!isFixed && timer.domains) {
                const domainsSpan = document.createElement('small');
                domainsSpan.textContent = `Domains: ${timer.domains.join(', ')}`;
                domainsSpan.style.cssText = 'color: #94a3b8; font-size: 11px; margin-top: 2px; display: block;';
                leftSide.appendChild(domainsSpan);
            } else if (timer.id === 'web') {
                const domainsSpan = document.createElement('small');
                domainsSpan.textContent = 'All other websites';
                domainsSpan.style.cssText = 'color: #64748b; font-size: 11px; margin-top: 2px; display: block;';
                leftSide.appendChild(domainsSpan);
            }

            if (timer.id !== 'overall' && Array.isArray(timer.excludedDomains) && timer.excludedDomains.length > 0) {
                const exclusionsSpan = document.createElement('small');
                exclusionsSpan.textContent = `Excluded: ${timer.excludedDomains.join(', ')}`;
                exclusionsSpan.style.cssText = 'color:#EF5350; font-size:10px; margin-top:1px; display:block;';
                leftSide.appendChild(exclusionsSpan);
            }

            const rightSide = document.createElement('div');
            rightSide.style.cssText = 'display: flex; align-items: center; gap: 8px;';

            const limitInput = document.createElement('input');
            limitInput.type = 'number';
            limitInput.min = '-1';
            limitInput.value = timer.limitMinutes >= 0 ? timer.limitMinutes : '';
            limitInput.placeholder = 'Min';
            limitInput.style.cssText = 'width: 70px; margin-top: 0; padding: 6px 10px;';

            limitInput.addEventListener('change', () => {
                const val = parseInt(limitInput.value);
                saveTimerLimit(timer.id, isNaN(val) ? -1 : val);
            });

            rightSide.appendChild(limitInput);

            const minLabel = document.createElement('small');
            minLabel.textContent = 'min/day';
            minLabel.style.marginTop = '0';
            rightSide.appendChild(minLabel);

            if (!isFixed) {
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.style.cssText = 'margin-top: 0; margin-left: 8px; padding: 4px 8px; font-size: 11px; background-color: transparent; color: #94a3b8; box-shadow: none; text-transform: lowercase;';
                applyRemoveButtonStyles(removeBtn);
                removeBtn.addEventListener('click', () => removeTimer(timer.id));
                rightSide.appendChild(removeBtn);
            }

            headerRow.appendChild(leftSide);
            headerRow.appendChild(rightSide);
            div.appendChild(headerRow);

            const usageRow = document.createElement('div');
            usageRow.style.cssText = 'margin-top: 8px;';

            const usageTextDiv = document.createElement('div');
            usageTextDiv.style.cssText = 'display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-bottom: 4px;';

            const usedText = document.createElement('span');
            usedText.textContent = `${formatMinSec(timer.secondsUsedToday)} used`;

            const limitText = document.createElement('span');
            limitText.textContent = timer.limitMinutes < 0 ? 'No limit set' : timer.limitMinutes === 0 ? 'Always block' : `${timer.limitMinutes}m/day limit`;

            usageTextDiv.appendChild(usedText);
            usageTextDiv.appendChild(limitText);
            usageRow.appendChild(usageTextDiv);

            const usageTrack = document.createElement('div');
            usageTrack.style.cssText = 'height: 6px; background: rgba(15, 23, 42, 0.5); border-radius: 3px; overflow: hidden;';

            const usageFill = document.createElement('div');
            usageFill.style.cssText = 'height: 100%; width: 0%; border-radius: 3px; transition: width 0.3s;';

            const pct = timer.limitMinutes > 0 ? Math.min((timer.secondsUsedToday / (timer.limitMinutes * 60)) * 100, 100) : 0;
            usageFill.style.width = `${pct}%`;

            let color = '#66BB6A'; // Green for custom
            if (timer.id === 'youtube') color = '#FF4081';
            else if (timer.id === 'reddit') color = '#42A5F5';
            else if (timer.id === 'overall') color = '#AB47BC'; // Purple for overall

            usageFill.style.background = pct >= 100 ? '#EF5350' : color;

            usageTrack.appendChild(usageFill);
            usageRow.appendChild(usageTrack);
            div.appendChild(usageRow);

            listContainer.appendChild(div);
        });
    }

    function saveTimerLimit(timerId, limitMinutes) {
        chrome.storage.local.get(['unproductiveTimers'], (res) => {
            const timers = res.unproductiveTimers || {};
            if (timers[timerId]) {
                timers[timerId].limitMinutes = limitMinutes;
                chrome.storage.local.set({ unproductiveTimers: timers }, () => {
                    renderTimerListUI(timers);
                });
            }
        });
    }

    function removeTimer(timerId) {
        if (confirm('Are you sure you want to remove this timer?')) {
            chrome.storage.local.get(['unproductiveTimers'], (res) => {
                const timers = res.unproductiveTimers || {};
                delete timers[timerId];
                chrome.storage.local.set({ unproductiveTimers: timers }, () => {
                    renderTimerListUI(timers);
                });
            });
        }
    }

    // Save Logic
    function saveAllSettings() {
        const ratioVal = parseFloat(heuristicDominanceRatioInput && heuristicDominanceRatioInput.value);
        const ratio = isNaN(ratioVal) || ratioVal < 1 ? 2.0 : ratioVal;

        const selectedModeRadio = Array.from(modeRadios).find(r => r.checked);
        const blockingMode = selectedModeRadio ? selectedModeRadio.value : 'LENIENT';

        const selectedActionRadio = Array.from(actionRadios).find(r => r.checked);
        const blockAction = selectedActionRadio ? selectedActionRadio.value : (blockingMode === 'STRICT' ? 'RICKROLL' : 'GREYSCALE');

        const useMozillaForYoutube = useMozillaForYoutubeInput ? useMozillaForYoutubeInput.checked : false;
        const useMozillaForReddit = useMozillaForRedditInput ? useMozillaForRedditInput.checked : false;

        chrome.storage.local.set({
            blockingMode,
            heuristicDominanceRatio: ratio,
            blockAction,
            useMozillaForYoutube,
            useMozillaForReddit
        });
    }

    // Event Listeners
    modeRadios.forEach(radio => {
        radio.addEventListener('change', (event) => {
            const newMode = event.target.value;
            updateModeDescriptionUI(newMode);

            // Auto-switch block action based on mode default
            const targetAction = newMode === 'STRICT' ? 'RICKROLL' : 'GREYSCALE';
            actionRadios.forEach(ar => ar.checked = (ar.value === targetAction));

            saveAllSettings();
        });
    });

    actionRadios.forEach(radio => radio.addEventListener('change', saveAllSettings));
    [heuristicDominanceRatioInput].forEach(el => {
        if (el) el.addEventListener('change', saveAllSettings);
    });
    [useMozillaForYoutubeInput, useMozillaForRedditInput].forEach(el => {
        if (el) el.addEventListener('change', saveAllSettings);
    });

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const name = newNameInput ? newNameInput.value.trim() : '';
            const domainsStr = newDomainsInput ? newDomainsInput.value.trim() : '';
            const exclusionsStr = newExclusionsInput ? newExclusionsInput.value.trim() : '';
            const limitVal = newLimitInput ? parseInt(newLimitInput.value) : NaN;

            if (!name || !domainsStr) return;

            const domains = domainsStr.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
            if (domains.length === 0) return;

            const excludedDomains = exclusionsStr.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

            const limitMinutes = isNaN(limitVal) ? -1 : limitVal;

            chrome.storage.local.get(['unproductiveTimers'], (res) => {
                const timers = res.unproductiveTimers || {
                    overall: { id: 'overall', name: 'Overall Limit', domains: [], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0, isOverall: true },
                    youtube: { id: 'youtube', name: 'YouTube', domains: ['youtube.com', 'youtu.be'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
                    reddit: { id: 'reddit', name: 'Reddit', domains: ['reddit.com'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
                    web: { id: 'web', name: 'Other Websites', domains: ['*'], excludedDomains: ['youtube.com', 'youtu.be', 'reddit.com'], limitMinutes: -1, secondsUsedToday: 0 }
                };

                const newId = 'timer_' + Date.now();
                timers[newId] = {
                    id: newId,
                    name: name,
                    domains: domains,
                    excludedDomains: excludedDomains,
                    limitMinutes: limitMinutes,
                    secondsUsedToday: 0
                };

                chrome.storage.local.set({ unproductiveTimers: timers }, () => {
                    if (newNameInput) newNameInput.value = '';
                    if (newDomainsInput) newDomainsInput.value = '';
                    if (newExclusionsInput) newExclusionsInput.value = '';
                    if (newLimitInput) newLimitInput.value = '';
                    if (statusEl) {
                        statusEl.textContent = 'Timer added successfully!';
                        statusEl.style.display = 'block';
                        setTimeout(() => statusEl.style.display = 'none', 3000);
                    }
                    renderTimerListUI(timers);
                });
            });
        });
    }

    // Add Homepage button handler
    if (addHomepageBtn) {
        addHomepageBtn.addEventListener('click', () => {
            const domain = newHomepageDomainInput ? newHomepageDomainInput.value.trim().toLowerCase() : '';
            const limitVal = newHomepageLimitInput ? parseInt(newHomepageLimitInput.value) : NaN;

            if (!domain) return;

            let cleanDomain = domain;
            try {
                if (domain.startsWith('http://') || domain.startsWith('https://')) {
                    cleanDomain = new URL(domain).hostname;
                } else if (domain.includes('/')) {
                    cleanDomain = domain.split('/')[0];
                }
            } catch(e) {}
            cleanDomain = cleanDomain.replace(/^www\./, '');

            if (!cleanDomain) return;

            const limit = isNaN(limitVal) ? -1 : limitVal;

            if (homepageBlocklist.some(h => h.domain === cleanDomain)) {
                return;
            }

            homepageBlocklist.push({
                domain: cleanDomain,
                limitMinutes: limit,
                secondsUsedToday: 0
            });

            chrome.storage.local.set({ homepageBlocklist }, () => {
                if (newHomepageDomainInput) newHomepageDomainInput.value = '';
                if (newHomepageLimitInput) newHomepageLimitInput.value = '';
                if (newHomepageStatusEl) {
                    newHomepageStatusEl.textContent = 'Homepage added successfully!';
                    newHomepageStatusEl.style.display = 'block';
                    setTimeout(() => newHomepageStatusEl.style.display = 'none', 3000);
                }
                renderHomepageListUI(homepageBlocklist);
            });
        });
    }

    // Rendering
    function renderStrictUrls(list) {
        if (!strictUrlList) return;
        strictUrlList.innerHTML = '';
        if (!list || list.length === 0) {
            strictUrlList.innerHTML = '<li style="color: #9ca3af; font-style: italic;">No URLs configured.</li>';
            return;
        }

        const ordered = list.slice().reverse();
        ordered.forEach(item => {
            const li = document.createElement('li');
            li.style.flexDirection = 'column';
            li.style.alignItems = 'stretch';
            li.style.padding = '12px';

            const mainRow = document.createElement('div');
            mainRow.style.display = 'flex';
            mainRow.style.justifyContent = 'space-between';
            mainRow.style.alignItems = 'center';

            const urlSpan = document.createElement('span');
            urlSpan.textContent = item.url;
            urlSpan.style.fontWeight = '700';
            urlSpan.style.fontSize = '14px';

            const removeButton = document.createElement('button');
            removeButton.textContent = 'remove';
            applyRemoveButtonStyles(removeButton);
            removeButton.addEventListener('click', () => {
                strictUrlBlocklist = strictUrlBlocklist.filter(u => u.url !== item.url);
                chrome.storage.local.set({ strictUrlBlocklist }, () => renderStrictUrls(strictUrlBlocklist));
            });

            mainRow.appendChild(urlSpan);
            mainRow.appendChild(removeButton);
            li.appendChild(mainRow);

            if (item.limitMinutes > 0) {
                const totalSeconds = item.limitMinutes * 60;
                const remainingSeconds = Math.max(0, totalSeconds - item.secondsUsedToday);
                const percentage = (remainingSeconds / totalSeconds) * 100;
                const circum = 100.53;
                const dashOffset = circum - (percentage / 100) * circum;

                const timerContainer = document.createElement('div');
                timerContainer.className = 'timer-container';

                timerContainer.innerHTML = `
                    <div class="timer-circle-box">
                        <svg width="36" height="36" viewBox="0 0 36 36">
                            <circle class="timer-circle-bg" cx="18" cy="18" r="16"></circle>
                            <circle class="timer-circle-progress" cx="18" cy="18" r="16" 
                                style="stroke-dasharray: 100.53; stroke-dashoffset: ${dashOffset.toFixed(2)};"></circle>
                        </svg>
                    </div>
                    <div class="timer-info">
                        <span class="timer-label">Time Remaining</span>
                        <span class="timer-value">${formatTimeRemaining(remainingSeconds)}</span>
                    </div>
                `;
                li.appendChild(timerContainer);
            } else {
                const alwaysBlocked = document.createElement('div');
                alwaysBlocked.style.marginTop = '8px';
                alwaysBlocked.style.fontSize = '11px';
                alwaysBlocked.style.color = '#FF4081';
                alwaysBlocked.style.fontWeight = '600';
                alwaysBlocked.style.textTransform = 'uppercase';
                alwaysBlocked.style.letterSpacing = '0.05em';
                alwaysBlocked.textContent = '● Always Blocked';
                li.appendChild(alwaysBlocked);
            }

            strictUrlList.appendChild(li);
        });
    }

    function renderExactUrls(list) {
        if (!exactUrlList) return;
        exactUrlList.innerHTML = '';
        if (!list || list.length === 0) {
            exactUrlList.innerHTML = '<li style="color: #9ca3af; font-style: italic;">No exact URLs configured.</li>';
            return;
        }
        const ordered = list.slice().reverse();
        ordered.forEach(url => {
            const li = document.createElement('li');
            li.textContent = url;
            const removeButton = document.createElement('button');
            removeButton.textContent = 'remove';
            applyRemoveButtonStyles(removeButton);
            removeButton.addEventListener('click', () => {
                exactUrlBlocklist = exactUrlBlocklist.filter(u => u !== url);
                chrome.storage.local.set({ exactUrlBlocklist: exactUrlBlocklist }, () => renderExactUrls(exactUrlBlocklist));
            });
            li.appendChild(removeButton);
            exactUrlList.appendChild(li);
        });
    }

    if (addStrictUrlButton && strictUrlInput) {
        addStrictUrlButton.addEventListener('click', () => {
            const url = strictUrlInput.value.trim();
            const limit = parseInt(strictUrlLimitInput.value) || 0;
            if (!url) return;

            const existing = strictUrlBlocklist.find(u => u.url === url);
            if (!existing) {
                strictUrlBlocklist.push({ url, limitMinutes: limit, secondsUsedToday: 0 });
                chrome.storage.local.set({ strictUrlBlocklist }, () => {
                    strictUrlInput.value = '';
                    strictUrlLimitInput.value = '';
                    renderStrictUrls(strictUrlBlocklist);
                });
            }
        });
    }

    if (addExactUrlButton && exactUrlInput) {
        addExactUrlButton.addEventListener('click', () => {
            const url = exactUrlInput.value.trim();
            if (!url) return;
            if (!exactUrlBlocklist.includes(url)) {
                exactUrlBlocklist.push(url);
                chrome.storage.local.set({ exactUrlBlocklist: exactUrlBlocklist }, () => {
                    exactUrlInput.value = '';
                    renderExactUrls(exactUrlBlocklist);
                });
            }
        });
    }

    // --- Reports Logic ---
    const reportsContainer = document.getElementById('reportsContent');
    const clearHistoryBtn = document.getElementById('clearHistory');

    const barColors = [
        '#FF4081', '#42A5F5', '#66BB6A', '#FFA726', '#AB47BC',
        '#26C6DA', '#EF5350', '#8D6E63', '#EC407A', '#7E57C2'
    ];

    function formatDuration(totalSeconds) {
        if (!totalSeconds || totalSeconds < 1) return '0s';
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function getWeekDayLabel(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'short' });
    }

    function getLast7Days() {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toISOString().split('T')[0]);
        }
        return days;
    }

    function renderReports() {
        chrome.storage.local.get(['timeHistory'], (res) => {
            const history = res.timeHistory || {};
            const todayStr = new Date().toISOString().split('T')[0];
            const todayData = history[todayStr] || {};

            // Check if there's any data at all
            const hasAnyData = Object.keys(history).length > 0;
            if (!hasAnyData) {
                reportsContainer.innerHTML = '<div class="empty-state">No browsing data yet. Start browsing and your time will be tracked here.</div>';
                return;
            }

            // Today's stats
            const todayEntries = Object.entries(todayData).sort((a, b) => b[1] - a[1]);
            const todayTotal = todayEntries.reduce((sum, [, s]) => sum + s, 0);
            const todaySites = todayEntries.length;
            const topSite = todayEntries.length > 0 ? todayEntries[0][0] : '—';

            // Weekly totals for the bar chart
            const last7 = getLast7Days();
            const weeklyTotals = last7.map(day => {
                const dayData = history[day] || {};
                return { date: day, total: Object.values(dayData).reduce((s, v) => s + v, 0) };
            });

            // Weekly per-site aggregation for the table
            const weeklySiteMap = {};
            last7.forEach(day => {
                const dayData = history[day] || {};
                Object.entries(dayData).forEach(([domain, secs]) => {
                    weeklySiteMap[domain] = (weeklySiteMap[domain] || 0) + secs;
                });
            });

            let html = '';

            // --- Stat Cards ---
            html += `
                <div class="stats-row" style="margin-top: 16px;">
                    <div class="stat-card">
                        <div class="stat-value">${formatDuration(todayTotal)}</div>
                        <div class="stat-label">Today</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${todaySites}</div>
                        <div class="stat-label">Sites Today</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" style="font-size: 14px; word-break: break-all;">${topSite}</div>
                        <div class="stat-label">Most Used</div>
                    </div>
                </div>`;

            // --- Today's Bar Chart ---
            if (todayEntries.length > 0) {
                const maxSeconds = todayEntries[0][1];
                html += '<div class="chart-section"><h4>Today\'s Breakdown</h4><div class="bar-chart">';
                todayEntries.slice(0, 10).forEach(([domain, secs], i) => {
                    const pct = maxSeconds > 0 ? (secs / maxSeconds) * 100 : 0;
                    const color = barColors[i % barColors.length];
                    html += `
                        <div class="bar-row">
                            <span class="bar-label" title="${domain}">${domain}</span>
                            <div class="bar-track">
                                <div class="bar-fill" style="width: ${pct}%; background: ${color};"></div>
                            </div>
                            <span class="bar-time">${formatDuration(secs)}</span>
                        </div>`;
                });
                html += '</div></div>';
            }

            // --- 7-Day Trend Chart ---
            const maxWeekly = Math.max(...weeklyTotals.map(d => d.total), 1);
            html += '<div class="chart-section"><h4>Last 7 Days</h4><div class="weekly-chart">';
            weeklyTotals.forEach((day, i) => {
                const heightPct = (day.total / maxWeekly) * 100;
                const isToday = day.date === todayStr;
                const color = isToday ? '#FF4081' : '#42A5F5';
                html += `
                    <div class="weekly-bar">
                        <span class="weekly-bar-value">${day.total > 0 ? formatDuration(day.total) : ''}</span>
                        <div class="weekly-bar-fill" style="height: ${Math.max(heightPct, 2)}%; background: ${color};"></div>
                        <span class="weekly-bar-label">${getWeekDayLabel(day.date)}</span>
                    </div>`;
            });
            html += '</div></div>';

            // --- Per-Site Table ---
            const allSites = new Set([...Object.keys(todayData), ...Object.keys(weeklySiteMap)]);
            if (allSites.size > 0) {
                const tableRows = Array.from(allSites)
                    .map(domain => ({
                        domain,
                        today: todayData[domain] || 0,
                        week: weeklySiteMap[domain] || 0
                    }))
                    .sort((a, b) => b.week - a.week);

                html += `
                    <div class="chart-section">
                        <h4>Per-Site Breakdown</h4>
                        <table class="site-table">
                            <thead><tr><th>Website</th><th>Today</th><th>This Week</th></tr></thead>
                            <tbody>`;
                tableRows.forEach(row => {
                    html += `<tr><td>${row.domain}</td><td>${formatDuration(row.today)}</td><td>${formatDuration(row.week)}</td></tr>`;
                });
                html += '</tbody></table></div>';
            }

            reportsContainer.innerHTML = html;
        });
    }

    // Initial render of reports
    renderReports();

    // Clear history
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Clear all browsing time history? This cannot be undone.')) {
                chrome.storage.local.remove('timeHistory', () => {
                    renderReports();
                });
            }
        });
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.strictUrlBlocklist) {
            strictUrlBlocklist = changes.strictUrlBlocklist.newValue || [];
            renderStrictUrls(strictUrlBlocklist);
        }
        if (changes.exactUrlBlocklist) {
            exactUrlBlocklist = changes.exactUrlBlocklist.newValue || [];
            renderExactUrls(exactUrlBlocklist);
        }
        if (changes.homepageBlocklist) {
            homepageBlocklist = changes.homepageBlocklist.newValue || [];
            renderHomepageListUI(homepageBlocklist);
        }
        if (changes.blockingMode) {
            const mode = changes.blockingMode.newValue;
            modeRadios.forEach(r => r.checked = (r.value === mode));
            updateModeDescriptionUI(mode);
        }
        if (changes.blockAction) {
            const action = changes.blockAction.newValue;
            actionRadios.forEach(r => r.checked = (r.value === action));
        }
        if (changes.timeHistory) {
            renderReports();
        }
        if (changes.unproductiveTimers) {
            renderTimerListUI(changes.unproductiveTimers.newValue || {});
        }
        if (changes.useMozillaForYoutube) {
            if (useMozillaForYoutubeInput) useMozillaForYoutubeInput.checked = !!changes.useMozillaForYoutube.newValue;
        }
        if (changes.useMozillaForReddit) {
            if (useMozillaForRedditInput) useMozillaForRedditInput.checked = !!changes.useMozillaForReddit.newValue;
        }
    });
});
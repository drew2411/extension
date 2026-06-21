// options-timers.js — Content timers tab (unproductive daily limits)

function initTimers() {
    const listContainer = document.getElementById('timersListContainer');
    const newNameInput = document.getElementById('newTimerName');
    const newDomainsInput = document.getElementById('newTimerDomains');
    const newExclusionsInput = document.getElementById('newTimerExclusions');
    const newLimitInput = document.getElementById('newTimerLimit');
    const addBtn = document.getElementById('addCustomTimerBtn');
    const statusEl = document.getElementById('newTimerStatus');

    function renderTimers() {
        chrome.storage.local.get(['unproductiveTimers'], (res) => {
            const timers = res.unproductiveTimers || {
                overall: { id: 'overall', name: 'Overall Limit', domains: [], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0, isOverall: true },
                youtube: { id: 'youtube', name: 'YouTube', domains: ['youtube.com', 'youtu.be'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
                reddit: { id: 'reddit', name: 'Reddit', domains: ['reddit.com'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
                web: { id: 'web', name: 'Other Websites', domains: ['*'], excludedDomains: ['youtube.com', 'youtu.be', 'reddit.com'], limitMinutes: -1, secondsUsedToday: 0 }
            };

            // Ensure overall exists
            if (!timers.overall) {
                timers.overall = { id: 'overall', name: 'Overall Limit', domains: [], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0, isOverall: true };
            }

            if (!listContainer) return;
            listContainer.innerHTML = '';

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
                div.style.cssText = 'background:rgba(15,23,42,0.3); padding:14px; border-radius:10px; border:1px solid rgba(148,163,184,0.1); margin-bottom:12px;';

                const isFixed = ['youtube', 'reddit', 'web', 'overall'].includes(timer.id);

                const headerRow = document.createElement('div');
                headerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';

                const leftSide = document.createElement('div');
                leftSide.style.cssText = 'display:flex; flex-direction:column;';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = timer.name;
                nameSpan.style.cssText = 'font-weight:600; font-size:14px; color:#fff;';
                leftSide.appendChild(nameSpan);

                // Domain details
                if (timer.id === 'overall') {
                    const domainsSpan = document.createElement('small');
                    domainsSpan.textContent = 'Sum of all website timers';
                    domainsSpan.style.cssText = 'color:#FF4081; font-size:11px; margin-top:2px; display:block; font-weight: 500;';
                    leftSide.appendChild(domainsSpan);
                } else if (!isFixed && timer.domains) {
                    const domainsSpan = document.createElement('small');
                    domainsSpan.textContent = `Domains: ${timer.domains.join(', ')}`;
                    domainsSpan.style.cssText = 'color:#94a3b8; font-size:11px; margin-top:2px; display:block;';
                    leftSide.appendChild(domainsSpan);
                } else if (timer.id === 'web') {
                    const domainsSpan = document.createElement('small');
                    domainsSpan.textContent = 'All other websites';
                    domainsSpan.style.cssText = 'color:#64748b; font-size:11px; margin-top:2px; display:block;';
                    leftSide.appendChild(domainsSpan);
                }

                // Exclusion details
                if (timer.id !== 'overall' && Array.isArray(timer.excludedDomains) && timer.excludedDomains.length > 0) {
                    const exclusionsSpan = document.createElement('small');
                    exclusionsSpan.textContent = `Excluded: ${timer.excludedDomains.join(', ')}`;
                    exclusionsSpan.style.cssText = 'color:#EF5350; font-size:10px; margin-top:1px; display:block;';
                    leftSide.appendChild(exclusionsSpan);
                }

                const rightSide = document.createElement('div');
                rightSide.style.cssText = 'display:flex; align-items:center; gap:8px;';

                const limitInput = document.createElement('input');
                limitInput.type = 'number';
                limitInput.min = '-1';
                limitInput.value = timer.limitMinutes >= 0 ? timer.limitMinutes : '';
                limitInput.placeholder = 'Min';
                limitInput.style.cssText = 'width:70px; margin:0; padding:6px 10px;';

                limitInput.addEventListener('change', () => {
                    const val = parseInt(limitInput.value);
                    saveTimerLimit(timer.id, isNaN(val) ? -1 : val);
                });

                rightSide.appendChild(limitInput);

                const minLabel = document.createElement('small');
                minLabel.textContent = 'min/day';
                minLabel.style.margin = '0';
                rightSide.appendChild(minLabel);

                if (!isFixed) {
                    const removeBtn = document.createElement('button');
                    removeBtn.textContent = 'Remove';
                    removeBtn.style.cssText = 'margin:0; margin-left:8px; padding:4px 8px; font-size:11px; background:transparent; color:#64748b; box-shadow:none; text-transform:lowercase;';
                    removeBtn.addEventListener('mouseover', () => removeBtn.style.color = '#FF4081');
                    removeBtn.addEventListener('mouseout', () => removeBtn.style.color = '#64748b');
                    removeBtn.addEventListener('click', () => removeTimer(timer.id));
                    rightSide.appendChild(removeBtn);
                }

                headerRow.appendChild(leftSide);
                headerRow.appendChild(rightSide);
                div.appendChild(headerRow);

                const usageRow = document.createElement('div');
                usageRow.style.cssText = 'margin-top:8px;';

                const usageTextDiv = document.createElement('div');
                usageTextDiv.className = 'usage-row';

                const usedText = document.createElement('span');
                usedText.textContent = `${window.formatMinSec(timer.secondsUsedToday)} used`;

                const limitText = document.createElement('span');
                limitText.textContent = window.limitLabel(timer.limitMinutes);

                usageTextDiv.appendChild(usedText);
                usageTextDiv.appendChild(limitText);
                usageRow.appendChild(usageTextDiv);

                const usageTrack = document.createElement('div');
                usageTrack.className = 'usage-track';

                const usageFill = document.createElement('div');
                usageFill.className = 'usage-fill';

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
        });
    }

    function saveTimerLimit(timerId, limitMinutes) {
        chrome.storage.local.get(['unproductiveTimers'], (res) => {
            const timers = res.unproductiveTimers || {};
            if (timers[timerId]) {
                timers[timerId].limitMinutes = limitMinutes;
                chrome.storage.local.set({ unproductiveTimers: timers }, () => {
                    renderTimers();
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
                    renderTimers();
                });
            });
        }
    }

    const typeWebsiteContent = document.getElementById('type-website-content');
    const typeGroupContent = document.getElementById('type-group-content');
    const contentWebsiteFields = document.getElementById('content-website-fields');
    const contentGroupFields = document.getElementById('content-group-fields');

    if (typeWebsiteContent && typeGroupContent) {
        typeWebsiteContent.addEventListener('change', () => {
            if (contentWebsiteFields) contentWebsiteFields.style.display = 'flex';
            if (contentGroupFields) contentGroupFields.style.display = 'none';
        });
        typeGroupContent.addEventListener('change', () => {
            if (contentWebsiteFields) contentWebsiteFields.style.display = 'none';
            if (contentGroupFields) contentGroupFields.style.display = 'flex';
        });
    }

    const addDomainBtn = document.getElementById('addCustomTimerDomainBtn');
    if (addDomainBtn) {
        addDomainBtn.addEventListener('click', () => {
            const domainInput = document.getElementById('newTimerDomain');
            const limitInput = document.getElementById('newTimerDomainLimit');

            const domain = domainInput ? domainInput.value.trim().toLowerCase() : '';
            const limitVal = limitInput ? parseInt(limitInput.value) : NaN;

            if (!domain) { window.showStatus('newTimerStatus', 'Domain is required.', true); return; }

            let cleanDomain = domain;
            try {
                if (domain.startsWith('http://') || domain.startsWith('https://')) {
                    cleanDomain = new URL(domain).hostname;
                } else if (domain.includes('/')) {
                    cleanDomain = domain.split('/')[0];
                }
            } catch(e) {}
            cleanDomain = cleanDomain.replace(/^www\./, '');

            if (!cleanDomain) { window.showStatus('newTimerStatus', 'Invalid domain.', true); return; }
            const limitMinutes = isNaN(limitVal) ? -1 : limitVal;

            chrome.storage.local.get(['unproductiveTimers'], (res) => {
                const timers = res.unproductiveTimers || {
                    overall: { id: 'overall', name: 'Overall Limit', domains: [], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0, isOverall: true },
                    youtube: { id: 'youtube', name: 'YouTube', domains: ['youtube.com', 'youtu.be'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
                    reddit: { id: 'reddit', name: 'Reddit', domains: ['reddit.com'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
                    web: { id: 'web', name: 'Other Websites', domains: ['*'], excludedDomains: ['youtube.com', 'youtu.be', 'reddit.com'], limitMinutes: -1, secondsUsedToday: 0 }
                };

                // Check duplicate
                for (const t of Object.values(timers)) {
                    if (t.name && t.name.toLowerCase() === cleanDomain.toLowerCase()) {
                        window.showStatus('newTimerStatus', 'Timer with this name/domain already exists.', true);
                        return;
                    }
                }

                const newId = 'timer_' + Date.now();
                timers[newId] = {
                    id: newId,
                    name: cleanDomain,
                    domains: [cleanDomain],
                    excludedDomains: [],
                    limitMinutes: limitMinutes,
                    secondsUsedToday: 0
                };

                chrome.storage.local.set({ unproductiveTimers: timers }, () => {
                    if (domainInput) domainInput.value = '';
                    if (limitInput) limitInput.value = '';
                    window.showStatus('newTimerStatus', 'Timer added successfully!');
                    renderTimers();
                });
            });
        });
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const name = newNameInput ? newNameInput.value.trim() : '';
            const domainsStr = newDomainsInput ? newDomainsInput.value.trim() : '';
            const exclusionsStr = newExclusionsInput ? newExclusionsInput.value.trim() : '';
            const limitVal = newLimitInput ? parseInt(newLimitInput.value) : NaN;

            if (!name) { window.showStatus('newTimerStatus', 'Timer name is required.', true); return; }
            if (!domainsStr) { window.showStatus('newTimerStatus', 'At least one domain is required.', true); return; }

            const domains = domainsStr.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
            if (domains.length === 0) { window.showStatus('newTimerStatus', 'Invalid domains list.', true); return; }

            const excludedDomains = exclusionsStr.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

            const limitMinutes = isNaN(limitVal) ? -1 : limitVal;

            chrome.storage.local.get(['unproductiveTimers'], (res) => {
                const timers = res.unproductiveTimers || {
                    overall: { id: 'overall', name: 'Overall Limit', domains: [], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0, isOverall: true },
                    youtube: { id: 'youtube', name: 'YouTube', domains: ['youtube.com', 'youtu.be'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
                    reddit: { id: 'reddit', name: 'Reddit', domains: ['reddit.com'], excludedDomains: [], limitMinutes: -1, secondsUsedToday: 0 },
                    web: { id: 'web', name: 'Other Websites', domains: ['*'], excludedDomains: ['youtube.com', 'youtu.be', 'reddit.com'], limitMinutes: -1, secondsUsedToday: 0 }
                };

                for (const t of Object.values(timers)) {
                    if (t.name && t.name.toLowerCase() === name.toLowerCase()) {
                        window.showStatus('newTimerStatus', 'Timer with this name already exists.', true);
                        return;
                    }
                }

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
                    window.showStatus('newTimerStatus', 'Timer added successfully!');
                    renderTimers();
                });
            });
        });
    }

    // Initial render
    renderTimers();

    // Export function to window so options.js listener can call it
    window.updateTimerUsage = function(timers) {
        renderTimers();
    };
}

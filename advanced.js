// advanced.js

document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const modeRadios = document.querySelectorAll('input[name="mode"]');
    const modeDescription = document.getElementById('modeDescription');
    const youtubeLimitInput = document.getElementById('youtubeLimitMinutes');
    const redditLimitInput = document.getElementById('redditLimitMinutes');
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
    const ytUnproductiveLimitInput = document.getElementById('ytUnproductiveLimit');
    const redditUnproductiveLimitInput = document.getElementById('redditUnproductiveLimit');
    const ytUsageText = document.getElementById('ytUsageText');
    const ytLimitText = document.getElementById('ytLimitText');
    const ytUsageBar = document.getElementById('ytUsageBar');
    const redditUsageText = document.getElementById('redditUsageText');
    const redditLimitText = document.getElementById('redditLimitText');
    const redditUsageBar = document.getElementById('redditUsageBar');

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
    let strictUrlBlocklist = [];
    let exactUrlBlocklist = [];
    let youtubeLimit = { limitMinutes: 0, secondsUsedToday: 0 };
    let redditLimit = { limitMinutes: 0, secondsUsedToday: 0 };

    // Initial Load
    chrome.storage.local.get([
        'blockingMode',
        'youtubeLimit',
        'redditLimit',
        'strictUrlBlocklist',
        'exactUrlBlocklist',
        'heuristicDominanceRatio',
        'blockAction',
        'unproductiveTimers'
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

        // Limits
        youtubeLimit = result.youtubeLimit || { limitMinutes: 0, secondsUsedToday: 0 };
        redditLimit = result.redditLimit || { limitMinutes: 0, secondsUsedToday: 0 };
        if (youtubeLimitInput) youtubeLimitInput.value = youtubeLimit.limitMinutes;
        if (redditLimitInput) redditLimitInput.value = redditLimit.limitMinutes;

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
            youtube: { limitMinutes: -1, secondsUsedToday: 0 },
            reddit: { limitMinutes: -1, secondsUsedToday: 0 }
        };
        if (ytUnproductiveLimitInput) {
            ytUnproductiveLimitInput.value = timers.youtube.limitMinutes >= 0 ? timers.youtube.limitMinutes : '';
        }
        if (redditUnproductiveLimitInput) {
            redditUnproductiveLimitInput.value = timers.reddit.limitMinutes >= 0 ? timers.reddit.limitMinutes : '';
        }
        updateTimerUsageUI(timers);
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

    function updateTimerUsageUI(timers) {
        if (!timers) return;
        const yt = timers.youtube || { limitMinutes: -1, secondsUsedToday: 0 };
        const rd = timers.reddit || { limitMinutes: -1, secondsUsedToday: 0 };

        // YouTube
        if (ytUsageText) ytUsageText.textContent = `${formatMinSec(yt.secondsUsedToday)} used`;
        if (ytLimitText) ytLimitText.textContent = yt.limitMinutes >= 0 ? `${yt.limitMinutes}m limit` : 'No limit (instant block)';
        if (ytUsageBar) {
            const pct = yt.limitMinutes > 0 ? Math.min((yt.secondsUsedToday / (yt.limitMinutes * 60)) * 100, 100) : 0;
            ytUsageBar.style.width = `${pct}%`;
            ytUsageBar.style.background = pct >= 100 ? '#EF5350' : '#FF4081';
        }

        // Reddit
        if (redditUsageText) redditUsageText.textContent = `${formatMinSec(rd.secondsUsedToday)} used`;
        if (redditLimitText) redditLimitText.textContent = rd.limitMinutes >= 0 ? `${rd.limitMinutes}m limit` : 'No limit (instant block)';
        if (redditUsageBar) {
            const pct = rd.limitMinutes > 0 ? Math.min((rd.secondsUsedToday / (rd.limitMinutes * 60)) * 100, 100) : 0;
            redditUsageBar.style.width = `${pct}%`;
            redditUsageBar.style.background = pct >= 100 ? '#EF5350' : '#42A5F5';
        }
    }

    function saveUnproductiveTimers() {
        chrome.storage.local.get(['unproductiveTimers'], (res) => {
            const timers = res.unproductiveTimers || {
                youtube: { limitMinutes: -1, secondsUsedToday: 0 },
                reddit: { limitMinutes: -1, secondsUsedToday: 0 }
            };
            const ytVal = ytUnproductiveLimitInput ? parseInt(ytUnproductiveLimitInput.value) : NaN;
            const rdVal = redditUnproductiveLimitInput ? parseInt(redditUnproductiveLimitInput.value) : NaN;
            timers.youtube.limitMinutes = isNaN(ytVal) ? -1 : ytVal;
            timers.reddit.limitMinutes = isNaN(rdVal) ? -1 : rdVal;
            chrome.storage.local.set({ unproductiveTimers: timers });
            updateTimerUsageUI(timers);
        });
    }

    // Save Logic
    function saveAllSettings() {
        const ratioVal = parseFloat(heuristicDominanceRatioInput && heuristicDominanceRatioInput.value);
        const ratio = isNaN(ratioVal) || ratioVal < 1 ? 2.0 : ratioVal;

        const selectedModeRadio = Array.from(modeRadios).find(r => r.checked);
        const blockingMode = selectedModeRadio ? selectedModeRadio.value : 'LENIENT';

        const selectedActionRadio = Array.from(actionRadios).find(r => r.checked);
        const blockAction = selectedActionRadio ? selectedActionRadio.value : (blockingMode === 'STRICT' ? 'RICKROLL' : 'GREYSCALE');

        youtubeLimit.limitMinutes = parseInt(youtubeLimitInput.value) || 0;
        redditLimit.limitMinutes = parseInt(redditLimitInput.value) || 0;

        chrome.storage.local.set({
            blockingMode,
            heuristicDominanceRatio: ratio,
            blockAction,
            youtubeLimit,
            redditLimit
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
    [youtubeLimitInput, redditLimitInput, heuristicDominanceRatioInput].forEach(el => {
        if (el) el.addEventListener('change', saveAllSettings);
    });
    [ytUnproductiveLimitInput, redditUnproductiveLimitInput].forEach(el => {
        if (el) el.addEventListener('change', saveUnproductiveTimers);
    });

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
                const dashOffset = 100 - (percentage); // Simplified for 100 circumference

                const timerContainer = document.createElement('div');
                timerContainer.className = 'timer-container';

                timerContainer.innerHTML = `
                    <div class="timer-circle-box">
                        <svg width="36" height="36" viewBox="0 0 36 36">
                            <circle class="timer-circle-bg" cx="18" cy="18" r="16"></circle>
                            <circle class="timer-circle-progress" cx="18" cy="18" r="16" 
                                style="stroke-dasharray: 100; stroke-dashoffset: ${dashOffset};"></circle>
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
        if (changes.youtubeLimit) {
            youtubeLimit = changes.youtubeLimit.newValue || { limitMinutes: 0, secondsUsedToday: 0 };
            if (youtubeLimitInput) youtubeLimitInput.value = youtubeLimit.limitMinutes;
        }
        if (changes.redditLimit) {
            redditLimit = changes.redditLimit.newValue || { limitMinutes: 0, secondsUsedToday: 0 };
            if (redditLimitInput) redditLimitInput.value = redditLimit.limitMinutes;
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
            updateTimerUsageUI(changes.unproductiveTimers.newValue);
        }
    });
});
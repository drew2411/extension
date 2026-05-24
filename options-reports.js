// options-reports.js — Reports tab: 7-day chart, today breakdown, per-site table

const barColors = ['#FF4081','#42A5F5','#66BB6A','#FFA726','#AB47BC','#26C6DA','#EF5350','#8D6E63','#EC407A','#7E57C2'];

function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
    }
    return days;
}

function getWeekDayLabel(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}

function renderReports() {
    const container = document.getElementById('reportsContent');
    if (!container) return;

    chrome.storage.local.get(['timeHistory'], (res) => {
        const history   = res.timeHistory || {};
        const todayStr  = new Date().toISOString().split('T')[0];
        const todayData = history[todayStr] || {};

        if (!Object.keys(history).length) {
            container.innerHTML = '<div class="empty-state">No browsing data yet. Start browsing and your time will be tracked here.</div>';
            return;
        }

        const todayEntries = Object.entries(todayData).sort((a, b) => b[1] - a[1]);
        const todayTotal   = todayEntries.reduce((s, [, v]) => s + v, 0);
        const topSite      = todayEntries.length > 0 ? todayEntries[0][0] : '—';

        const last7 = getLast7Days();
        const weeklyTotals = last7.map(day => ({
            date: day,
            total: Object.values(history[day] || {}).reduce((s, v) => s + v, 0)
        }));

        const weeklySiteMap = {};
        last7.forEach(day => {
            Object.entries(history[day] || {}).forEach(([domain, secs]) => {
                weeklySiteMap[domain] = (weeklySiteMap[domain] || 0) + secs;
            });
        });

        let html = `
            <div class="stats-row" style="margin-top:14px;">
                <div class="stat-card"><div class="stat-value">${window.formatDuration(todayTotal)}</div><div class="stat-label">Today</div></div>
                <div class="stat-card"><div class="stat-value">${todayEntries.length}</div><div class="stat-label">Sites Today</div></div>
                <div class="stat-card"><div class="stat-value" style="font-size:13px;word-break:break-all;">${topSite}</div><div class="stat-label">Most Used</div></div>
            </div>`;

        // Today bar chart
        if (todayEntries.length) {
            const maxSec = todayEntries[0][1];
            html += '<div class="chart-section"><h4 style="margin-top:0;">Today\'s Breakdown</h4><div class="bar-chart">';
            todayEntries.slice(0, 10).forEach(([domain, secs], i) => {
                const pct = maxSec > 0 ? (secs / maxSec) * 100 : 0;
                html += `<div class="bar-row">
                    <span class="bar-label" title="${domain}">${domain}</span>
                    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${barColors[i % barColors.length]};"></div></div>
                    <span class="bar-time">${window.formatDuration(secs)}</span>
                </div>`;
            });
            html += '</div></div>';
        }

        // 7-day trend
        const maxWeekly = Math.max(...weeklyTotals.map(d => d.total), 1);
        html += '<div class="chart-section"><h4 style="margin-top:0;">Last 7 Days</h4><div class="weekly-chart">';
        weeklyTotals.forEach(day => {
            const h = (day.total / maxWeekly) * 100;
            const isToday = day.date === todayStr;
            html += `<div class="weekly-bar">
                <span class="weekly-bar-value">${day.total > 0 ? window.formatDuration(day.total) : ''}</span>
                <div class="weekly-bar-fill" style="height:${Math.max(h, 2)}%;background:${isToday ? '#FF4081' : '#42A5F5'};"></div>
                <span class="weekly-bar-label">${getWeekDayLabel(day.date)}</span>
            </div>`;
        });
        html += '</div></div>';

        // Per-site table
        const allSites = new Set([...Object.keys(todayData), ...Object.keys(weeklySiteMap)]);
        if (allSites.size) {
            const rows = Array.from(allSites).map(d => ({ domain: d, today: todayData[d] || 0, week: weeklySiteMap[d] || 0 })).sort((a, b) => b.week - a.week);
            html += `<div class="chart-section"><h4 style="margin-top:0;">Per-Site Breakdown</h4>
                <table class="site-table"><thead><tr><th>Website</th><th>Today</th><th>This Week</th></tr></thead><tbody>`;
            rows.forEach(r => { html += `<tr><td>${r.domain}</td><td>${window.formatDuration(r.today)}</td><td>${window.formatDuration(r.week)}</td></tr>`; });
            html += '</tbody></table></div>';
        }

        container.innerHTML = html;
        lucide.createIcons();
    });
}

// Clear history button
document.addEventListener('DOMContentLoaded', () => {
    const clearBtn = document.getElementById('clearHistory');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('Clear all browsing history? This cannot be undone.')) {
                chrome.storage.local.remove('timeHistory', renderReports);
            }
        });
    }
});

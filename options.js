// options.js — Main: tab navigation + shared state init

document.addEventListener('DOMContentLoaded', () => {
    // --- Tab Navigation ---
    const menuItems   = document.querySelectorAll('.menu-item');
    const tabSections = document.querySelectorAll('.tab-section');

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            menuItems.forEach(m => m.classList.remove('active'));
            tabSections.forEach(s => s.classList.remove('active'));
            item.classList.add('active');
            const sec = document.getElementById(`tab-${item.dataset.tab}`);
            if (sec) sec.classList.add('active');
            if (item.dataset.tab === 'reports') renderReports();
        });
    });

    // --- Helpers (shared across modules via window) ---
    window.formatMinSec = (totalSeconds) => {
        if (!totalSeconds || totalSeconds < 1) return '0s';
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    };

    window.formatDuration = (totalSeconds) => {
        if (!totalSeconds || totalSeconds < 1) return '0s';
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    };

    window.formatTimeRemaining = (seconds) => {
        if (seconds <= 0) return '00:00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
    };

    window.limitLabel = (limitMinutes) => {
        if (limitMinutes < 0)  return 'No restriction';
        if (limitMinutes === 0) return 'Always block';
        return `${limitMinutes}m/day limit`;
    };

    window.showStatus = (elId, msg, isError = false) => {
        const el = document.getElementById(elId);
        if (!el) return;
        el.textContent = msg;
        el.style.color = isError ? '#EF5350' : '#22c55e';
        setTimeout(() => { el.textContent = ''; }, 3000);
    };

    // --- Init all modules ---
    if (typeof initIntents   === 'function') initIntents();
    if (typeof initBlocking  === 'function') initBlocking();
    if (typeof initTimers    === 'function') initTimers();
    if (typeof initSettings  === 'function') initSettings();
    renderReports();

    // --- Storage change listener (global) ---
    chrome.storage.onChanged.addListener((changes, ns) => {
        if (ns !== 'local') return;
        if (changes.intents          && typeof renderIntents    === 'function') renderIntents(changes.intents.newValue || []);
        if (changes.homepageBlocklist && typeof renderHomepages === 'function') renderHomepages(changes.homepageBlocklist.newValue || []);
        if (changes.unproductiveTimers && typeof updateTimerUsage === 'function') updateTimerUsage(changes.unproductiveTimers.newValue);
        if (changes.useMozillaForYoutube) {
            const el = document.getElementById('useMozillaForYoutube');
            if (el) el.checked = !!changes.useMozillaForYoutube.newValue;
        }
        if (changes.useMozillaForReddit) {
            const el = document.getElementById('useMozillaForReddit');
            if (el) el.checked = !!changes.useMozillaForReddit.newValue;
        }
        if (changes.strictUrlBlocklist) {
            const list = changes.strictUrlBlocklist.newValue || [];
            if (typeof renderStrictUrls === 'function') renderStrictUrls(list);
        }
        if (changes.exactUrlBlocklist) {
            const list = changes.exactUrlBlocklist.newValue || [];
            if (typeof renderExactUrls === 'function') renderExactUrls(list);
        }
        if (changes.timeHistory && document.getElementById('tab-reports').classList.contains('active')) {
            renderReports();
        }
    });

    // Initial render of icons
    lucide.createIcons();
});

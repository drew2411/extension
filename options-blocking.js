// options-blocking.js — Blocking tab: homepage timers + strict/exact URL lists

function initBlocking() {
    let homepageBlocklist  = [];
    let strictUrlBlocklist = [];
    let exactUrlBlocklist  = [];

    chrome.storage.local.get(['homepageBlocklist', 'strictUrlBlocklist', 'exactUrlBlocklist'], (res) => {
        homepageBlocklist = res.homepageBlocklist || [
            { domain: 'youtube.com', limitMinutes: -1, secondsUsedToday: 0 },
            { domain: 'reddit.com', limitMinutes: -1, secondsUsedToday: 0 }
        ];

        strictUrlBlocklist = Array.isArray(res.strictUrlBlocklist) ? res.strictUrlBlocklist.map(item =>
            typeof item === 'string' ? { url: item, limitMinutes: -1, secondsUsedToday: 0 } : item
        ) : [];
        exactUrlBlocklist = Array.isArray(res.exactUrlBlocklist) ? res.exactUrlBlocklist : [];

        renderHomepages(homepageBlocklist);
        renderStrictUrls(strictUrlBlocklist);
        renderExactUrls(exactUrlBlocklist);
    });

    // Dynamic Homepage blocklist rendering
    function renderHomepages(list) {
        homepageBlocklist = list;
        const container = document.getElementById('homepageListContainer');
        if (!container) return;
        container.innerHTML = '';

        list.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'home-row';
            row.style.flexDirection = 'column';
            row.style.alignItems = 'stretch';
            row.style.padding = '14px';
            row.style.background = 'rgba(15,23,42,0.3)';
            row.style.borderRadius = '10px';
            row.style.border = '1px solid rgba(148,163,184,0.1)';
            row.style.marginBottom = '12px';

            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';

            const domainName = document.createElement('span');
            domainName.textContent = item.domain;
            domainName.style.fontWeight = '600';
            domainName.style.fontSize = '14px';

            const rightSide = document.createElement('div');
            rightSide.style.display = 'flex';
            rightSide.style.alignItems = 'center';
            rightSide.style.gap = '8px';

            const limitInput = document.createElement('input');
            limitInput.type = 'number';
            limitInput.min = '-1';
            limitInput.value = item.limitMinutes >= 0 ? item.limitMinutes : '';
            limitInput.placeholder = 'Min';
            limitInput.style.width = '70px';
            limitInput.style.margin = '0';
            limitInput.style.padding = '6px 10px';

            limitInput.addEventListener('change', () => {
                const val = parseInt(limitInput.value);
                item.limitMinutes = isNaN(val) ? -1 : val;
                chrome.storage.local.set({ homepageBlocklist }, () => {
                    renderHomepages(homepageBlocklist);
                });
            });

            rightSide.appendChild(limitInput);

            const label = document.createElement('small');
            label.textContent = 'min';
            label.style.margin = '0';
            rightSide.appendChild(label);

            const isDefault = ['youtube.com', 'reddit.com'].includes(item.domain.toLowerCase());
            if (!isDefault) {
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'remove';
                removeBtn.style.margin = '0';
                removeBtn.style.marginLeft = '8px';
                removeBtn.style.padding = '3px 8px';
                removeBtn.style.fontSize = '11px';
                removeBtn.style.background = 'transparent';
                removeBtn.style.color = '#64748b';
                removeBtn.style.boxShadow = 'none';
                removeBtn.style.textTransform = 'lowercase';

                removeBtn.addEventListener('mouseover', () => removeBtn.style.color = '#FF4081');
                removeBtn.addEventListener('mouseout', () => removeBtn.style.color = '#64748b');

                removeBtn.addEventListener('click', () => {
                    const newList = homepageBlocklist.filter(h => h.domain !== item.domain);
                    chrome.storage.local.set({ homepageBlocklist: newList }, () => {
                        renderHomepages(newList);
                    });
                });

                rightSide.appendChild(removeBtn);
            }

            header.appendChild(domainName);
            header.appendChild(rightSide);
            row.appendChild(header);

            const usageInfo = document.createElement('div');
            usageInfo.style.marginTop = '8px';

            const usageRow = document.createElement('div');
            usageRow.className = 'usage-row';
            usageRow.style.display = 'flex';
            usageRow.style.justifyContent = 'space-between';
            usageRow.style.fontSize = '11px';
            usageRow.style.color = '#94a3b8';
            usageRow.style.marginBottom = '4px';

            const usedText = document.createElement('span');
            usedText.textContent = `${window.formatMinSec(item.secondsUsedToday)} used`;

            const limitText = document.createElement('span');
            limitText.textContent = window.limitLabel(item.limitMinutes);

            usageRow.appendChild(usedText);
            usageRow.appendChild(limitText);
            usageInfo.appendChild(usageRow);

            const usageTrack = document.createElement('div');
            usageTrack.className = 'usage-track';
            usageTrack.style.height = '5px';
            usageTrack.style.background = 'rgba(15,23,42,0.5)';
            usageTrack.style.borderRadius = '3px';
            usageTrack.style.overflow = 'hidden';

            const usageFill = document.createElement('div');
            usageFill.className = 'usage-fill';
            usageFill.style.height = '100%';
            usageFill.style.borderRadius = '3px';
            usageFill.style.transition = 'width 0.4s';

            const pct = item.limitMinutes > 0 ? Math.min((item.secondsUsedToday / (item.limitMinutes * 60)) * 100, 100) : 0;
            usageFill.style.width = `${pct}%`;

            let color = '#66BB6A'; // Green for custom
            if (item.domain === 'youtube.com') color = '#FF4081';
            else if (item.domain === 'reddit.com') color = '#42A5F5';

            usageFill.style.background = pct >= 100 ? '#EF5350' : color;

            usageTrack.appendChild(usageFill);
            usageInfo.appendChild(usageTrack);
            row.appendChild(usageInfo);

            container.appendChild(row);
        });
    }

    // Add homepage button handler
    const addHomeBtn = document.getElementById('addHomepageBtn');
    if (addHomeBtn) {
        addHomeBtn.addEventListener('click', () => {
            const domainInput = document.getElementById('newHomepageDomain');
            const limitInput = document.getElementById('newHomepageLimit');

            const domain = domainInput ? domainInput.value.trim().toLowerCase() : '';
            const limitVal = limitInput ? parseInt(limitInput.value) : NaN;

            if (!domain) {
                window.showStatus('newHomepageStatus', 'Domain is required.', true);
                return;
            }

            let cleanDomain = domain;
            try {
                if (domain.startsWith('http://') || domain.startsWith('https://')) {
                    cleanDomain = new URL(domain).hostname;
                } else if (domain.includes('/')) {
                    cleanDomain = domain.split('/')[0];
                }
            } catch(e) {}
            cleanDomain = cleanDomain.replace(/^www\./, '');

            if (!cleanDomain) {
                window.showStatus('newHomepageStatus', 'Invalid domain.', true);
                return;
            }

            const limit = isNaN(limitVal) ? -1 : limitVal;

            if (homepageBlocklist.some(h => h.domain === cleanDomain)) {
                window.showStatus('newHomepageStatus', 'Domain already exists in list.', true);
                return;
            }

            homepageBlocklist.push({
                domain: cleanDomain,
                limitMinutes: limit,
                secondsUsedToday: 0
            });

            chrome.storage.local.set({ homepageBlocklist }, () => {
                if (domainInput) domainInput.value = '';
                if (limitInput) limitInput.value = '';
                window.showStatus('newHomepageStatus', 'Homepage limit added successfully!');
                renderHomepages(homepageBlocklist);
            });
        });
    }

    // Export function to window
    window.renderHomepages = renderHomepages;

    // Strict URL list
    document.getElementById('addStrictUrl').addEventListener('click', () => {
        const url   = document.getElementById('strictUrlInput').value.trim();
        const limit = parseInt(document.getElementById('strictUrlLimit').value);
        if (!url) return;
        if (!strictUrlBlocklist.find(u => u.url === url)) {
            strictUrlBlocklist.push({ url, limitMinutes: isNaN(limit) ? -1 : limit, secondsUsedToday: 0 });
            chrome.storage.local.set({ strictUrlBlocklist }, () => {
                document.getElementById('strictUrlInput').value = '';
                document.getElementById('strictUrlLimit').value = '';
                renderStrictUrls(strictUrlBlocklist);
            });
        }
    });

    window.renderStrictUrls = function(list) {
        strictUrlBlocklist = list;
        const ul = document.getElementById('strictUrlList');
        if (!ul) return;
        ul.innerHTML = '';
        if (!list.length) { ul.innerHTML = '<li style="color:#64748b;font-style:italic;">No URLs configured.</li>'; return; }

        list.slice().reverse().forEach(item => {
            const li = document.createElement('li');
            li.style.flexDirection = 'column';
            li.style.alignItems    = 'stretch';

            const mainRow = document.createElement('div');
            mainRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';

            const urlSpan = document.createElement('span');
            urlSpan.textContent = item.url;
            urlSpan.style.cssText = 'font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;';

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'remove';
            removeBtn.addEventListener('click', () => {
                strictUrlBlocklist = strictUrlBlocklist.filter(u => u.url !== item.url);
                chrome.storage.local.set({ strictUrlBlocklist }, () => renderStrictUrls(strictUrlBlocklist));
            });

            mainRow.appendChild(urlSpan);
            mainRow.appendChild(removeBtn);
            li.appendChild(mainRow);

            if (item.limitMinutes > 0) {
                const totalSec = item.limitMinutes * 60;
                const remaining = Math.max(0, totalSec - item.secondsUsedToday);
                const pct       = (remaining / totalSec) * 100;
                const circum    = 100.53;
                const offset    = circum - (pct / 100) * circum;

                const timerEl = document.createElement('div');
                timerEl.className = 'timer-container';
                timerEl.style.marginTop = '8px';
                timerEl.innerHTML = `
                    <div class="timer-circle-box">
                        <svg width="36" height="36" viewBox="0 0 36 36">
                            <circle class="timer-circle-bg" cx="18" cy="18" r="16"></circle>
                            <circle class="timer-circle-progress" cx="18" cy="18" r="16"
                                style="stroke-dasharray:${circum};stroke-dashoffset:${offset.toFixed(2)};"></circle>
                        </svg>
                    </div>
                    <div class="timer-info">
                        <span class="timer-label">Time Remaining</span>
                        <span class="timer-value">${window.formatTimeRemaining(remaining)}</span>
                    </div>`;
                li.appendChild(timerEl);
            } else {
                const tag = document.createElement('div');
                tag.style.cssText = 'margin-top:6px;font-size:10px;color:#FF4081;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;';
                tag.textContent   = item.limitMinutes === 0 ? '● Always Blocked' : '○ No Limit';
                li.appendChild(tag);
            }

            ul.appendChild(li);
        });
    };

    // Exact URL list
    document.getElementById('addExactUrl').addEventListener('click', () => {
        const url = document.getElementById('exactUrlInput').value.trim();
        if (!url || exactUrlBlocklist.includes(url)) return;
        exactUrlBlocklist.push(url);
        chrome.storage.local.set({ exactUrlBlocklist }, () => {
            document.getElementById('exactUrlInput').value = '';
            renderExactUrls(exactUrlBlocklist);
        });
    });

    window.renderExactUrls = function(list) {
        exactUrlBlocklist = list;
        const ul = document.getElementById('exactUrlList');
        if (!ul) return;
        ul.innerHTML = '';
        if (!list.length) { ul.innerHTML = '<li style="color:#64748b;font-style:italic;">No exact URLs configured.</li>'; return; }
        list.slice().reverse().forEach(url => {
            const li = document.createElement('li');
            li.textContent = url;
            const btn = document.createElement('button');
            btn.textContent = 'remove';
            btn.addEventListener('click', () => {
                exactUrlBlocklist = exactUrlBlocklist.filter(u => u !== url);
                chrome.storage.local.set({ exactUrlBlocklist }, () => renderExactUrls(exactUrlBlocklist));
            });
            li.appendChild(btn);
            ul.appendChild(li);
        });
    };
}

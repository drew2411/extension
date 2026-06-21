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

            const leftSide = document.createElement('div');
            leftSide.style.display = 'flex';
            leftSide.style.flexDirection = 'column';

            const domainName = document.createElement('span');
            domainName.style.fontWeight = '600';
            domainName.style.fontSize = '14px';

            const isGroup = !!item.domains;
            if (isGroup) {
                domainName.textContent = item.name;
                leftSide.appendChild(domainName);

                const domainsSpan = document.createElement('small');
                domainsSpan.textContent = `Domains: ${item.domains.join(', ')}`;
                domainsSpan.style.cssText = 'color:#94a3b8; font-size:11px; margin-top:2px; display:block;';
                leftSide.appendChild(domainsSpan);

                if (Array.isArray(item.excludedDomains) && item.excludedDomains.length > 0) {
                    const exclusionsSpan = document.createElement('small');
                    exclusionsSpan.textContent = `Excluded: ${item.excludedDomains.join(', ')}`;
                    exclusionsSpan.style.cssText = 'color:#EF5350; font-size:10px; margin-top:1px; display:block;';
                    leftSide.appendChild(exclusionsSpan);
                }
            } else {
                domainName.textContent = item.domain;
                leftSide.appendChild(domainName);
            }

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

            const isDefault = !isGroup && ['youtube.com', 'reddit.com'].includes(item.domain.toLowerCase());
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
                    const newList = homepageBlocklist.filter(h => {
                        if (isGroup) return h.name !== item.name;
                        return h.domain !== item.domain;
                    });
                    chrome.storage.local.set({ homepageBlocklist: newList }, () => {
                        renderHomepages(newList);
                    });
                });

                rightSide.appendChild(removeBtn);
            }

            header.appendChild(leftSide);
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
            const dLower = !isGroup ? (item.domain || '').toLowerCase() : '';
            if (dLower === 'youtube.com') color = '#FF4081';
            else if (dLower === 'reddit.com') color = '#42A5F5';

            usageFill.style.background = pct >= 100 ? '#EF5350' : color;

            usageTrack.appendChild(usageFill);
            usageInfo.appendChild(usageTrack);
            row.appendChild(usageInfo);

            container.appendChild(row);
        });
    }

    // --- Homepage Forms Toggle ---
    const typeWebsiteHome = document.getElementById('type-website-homepage');
    const typeGroupHome = document.getElementById('type-group-homepage');
    const homeWebsiteFields = document.getElementById('homepage-website-fields');
    const homeGroupFields = document.getElementById('homepage-group-fields');

    if (typeWebsiteHome && typeGroupHome) {
        typeWebsiteHome.addEventListener('change', () => {
            if (homeWebsiteFields) homeWebsiteFields.style.display = 'flex';
            if (homeGroupFields) homeGroupFields.style.display = 'none';
        });
        typeGroupHome.addEventListener('change', () => {
            if (homeWebsiteFields) homeWebsiteFields.style.display = 'none';
            if (homeGroupFields) homeGroupFields.style.display = 'flex';
        });
    }

    // Add homepage button handler (single website)
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

            if (homepageBlocklist.some(h => !h.domains && h.domain === cleanDomain)) {
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

    // Add homepage group button handler
    const addHomeGroupBtn = document.getElementById('addHomepageGroupBtn');
    if (addHomeGroupBtn) {
        addHomeGroupBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('newHomepageGroupName');
            const domainsInput = document.getElementById('newHomepageGroupDomains');
            const exclusionsInput = document.getElementById('newHomepageGroupExclusions');
            const limitInput = document.getElementById('newHomepageGroupLimit');

            const name = nameInput ? nameInput.value.trim() : '';
            const domainsStr = domainsInput ? domainsInput.value.trim() : '';
            const exclusionsStr = exclusionsInput ? exclusionsInput.value.trim() : '';
            const limitVal = limitInput ? parseInt(limitInput.value) : NaN;

            if (!name) { window.showStatus('newHomepageStatus', 'Group name is required.', true); return; }
            if (!domainsStr) { window.showStatus('newHomepageStatus', 'At least one domain is required.', true); return; }

            const domains = domainsStr.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
            if (domains.length === 0) { window.showStatus('newHomepageStatus', 'Invalid domains.', true); return; }

            const excludedDomains = exclusionsStr.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
            const limit = isNaN(limitVal) ? -1 : limitVal;

            if (homepageBlocklist.some(h => h.domains && h.name.toLowerCase() === name.toLowerCase())) {
                window.showStatus('newHomepageStatus', 'Group name already exists.', true);
                return;
            }

            homepageBlocklist.push({
                name,
                domains,
                excludedDomains,
                limitMinutes: limit,
                secondsUsedToday: 0
            });

            chrome.storage.local.set({ homepageBlocklist }, () => {
                if (nameInput) nameInput.value = '';
                if (domainsInput) domainsInput.value = '';
                if (exclusionsInput) exclusionsInput.value = '';
                if (limitInput) limitInput.value = '';
                window.showStatus('newHomepageStatus', 'Homepage group added successfully!');
                renderHomepages(homepageBlocklist);
            });
        });
    }

    // Export function to window
    window.renderHomepages = renderHomepages;

    // --- Website Blocklist Forms Toggle ---
    const typeWebsiteStrict = document.getElementById('type-website-strict');
    const typeGroupStrict = document.getElementById('type-group-strict');
    const strictWebsiteFields = document.getElementById('strict-website-fields');
    const strictGroupFields = document.getElementById('strict-group-fields');

    if (typeWebsiteStrict && typeGroupStrict) {
        typeWebsiteStrict.addEventListener('change', () => {
            if (strictWebsiteFields) strictWebsiteFields.style.display = 'flex';
            if (strictGroupFields) strictGroupFields.style.display = 'none';
        });
        typeGroupStrict.addEventListener('change', () => {
            if (strictWebsiteFields) strictWebsiteFields.style.display = 'none';
            if (strictGroupFields) strictGroupFields.style.display = 'flex';
        });
    }

    // Strict URL list (single website)
    document.getElementById('addStrictUrl').addEventListener('click', () => {
        const url   = document.getElementById('strictUrlInput').value.trim();
        const limit = parseInt(document.getElementById('strictUrlLimit').value);
        if (!url) return;
        if (!strictUrlBlocklist.find(u => !u.urls && u.url === url)) {
            strictUrlBlocklist.push({ url, limitMinutes: isNaN(limit) ? -1 : limit, secondsUsedToday: 0 });
            chrome.storage.local.set({ strictUrlBlocklist }, () => {
                document.getElementById('strictUrlInput').value = '';
                document.getElementById('strictUrlLimit').value = '';
                window.showStatus('newStrictStatus', 'Website limit added successfully!');
                renderStrictUrls(strictUrlBlocklist);
            });
        }
    });

    // Strict URL list (group)
    const addStrictUrlGroupBtn = document.getElementById('addStrictUrlGroupBtn');
    if (addStrictUrlGroupBtn) {
        addStrictUrlGroupBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('strictUrlGroupName');
            const urlsInput = document.getElementById('strictUrlGroupUrls');
            const exclusionsInput = document.getElementById('strictUrlGroupExclusions');
            const limitInput = document.getElementById('strictUrlGroupLimit');

            const name = nameInput ? nameInput.value.trim() : '';
            const urlsStr = urlsInput ? urlsInput.value.trim() : '';
            const exclusionsStr = exclusionsInput ? exclusionsInput.value.trim() : '';
            const limitVal = limitInput ? parseInt(limitInput.value) : NaN;

            if (!name) { window.showStatus('newStrictStatus', 'Group name is required.', true); return; }
            if (!urlsStr) { window.showStatus('newStrictStatus', 'At least one URL prefix is required.', true); return; }

            const urls = urlsStr.split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
            if (urls.length === 0) { window.showStatus('newStrictStatus', 'Invalid URLs.', true); return; }

            const excludedUrls = exclusionsStr.split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
            const limit = isNaN(limitVal) ? -1 : limitVal;

            if (strictUrlBlocklist.some(s => s.urls && s.name.toLowerCase() === name.toLowerCase())) {
                window.showStatus('newStrictStatus', 'Group name already exists.', true);
                return;
            }

            strictUrlBlocklist.push({
                name,
                urls,
                excludedUrls,
                limitMinutes: limit,
                secondsUsedToday: 0
            });

            chrome.storage.local.set({ strictUrlBlocklist }, () => {
                if (nameInput) nameInput.value = '';
                if (urlsInput) urlsInput.value = '';
                if (exclusionsInput) exclusionsInput.value = '';
                if (limitInput) limitInput.value = '';
                window.showStatus('newStrictStatus', 'Website group added successfully!');
                renderStrictUrls(strictUrlBlocklist);
            });
        });
    }

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

            const leftSide = document.createElement('div');
            leftSide.style.display = 'flex';
            leftSide.style.flexDirection = 'column';

            const urlSpan = document.createElement('span');
            urlSpan.style.cssText = 'font-weight:700;font-size:13px;color:#fff;overflow:hidden;text-overflow:ellipsis;';

            if (item.urls) {
                urlSpan.textContent = item.name;
                leftSide.appendChild(urlSpan);

                const urlsSpan = document.createElement('small');
                urlsSpan.textContent = `URLs: ${item.urls.join(', ')}`;
                urlsSpan.style.cssText = 'color:#94a3b8; font-size:11px; margin-top:2px; display:block;';
                leftSide.appendChild(urlsSpan);

                if (Array.isArray(item.excludedUrls) && item.excludedUrls.length > 0) {
                    const exclusionsSpan = document.createElement('small');
                    exclusionsSpan.textContent = `Excluded: ${item.excludedUrls.join(', ')}`;
                    exclusionsSpan.style.cssText = 'color:#EF5350; font-size:10px; margin-top:1px; display:block;';
                    leftSide.appendChild(exclusionsSpan);
                }
            } else {
                urlSpan.textContent = item.url;
                leftSide.appendChild(urlSpan);
            }

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'remove';
            removeBtn.addEventListener('click', () => {
                strictUrlBlocklist = strictUrlBlocklist.filter(u => {
                    if (item.urls) return u.name !== item.name;
                    return u.url !== item.url;
                });
                chrome.storage.local.set({ strictUrlBlocklist }, () => renderStrictUrls(strictUrlBlocklist));
            });

            mainRow.appendChild(leftSide);
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

    // --- Always Blocked Forms Toggle ---
    const typeWebsiteExact = document.getElementById('type-website-exact');
    const typeGroupExact = document.getElementById('type-group-exact');
    const exactWebsiteFields = document.getElementById('exact-website-fields');
    const exactGroupFields = document.getElementById('exact-group-fields');

    if (typeWebsiteExact && typeGroupExact) {
        typeWebsiteExact.addEventListener('change', () => {
            if (exactWebsiteFields) exactWebsiteFields.style.display = 'flex';
            if (exactGroupFields) exactGroupFields.style.display = 'none';
        });
        typeGroupExact.addEventListener('change', () => {
            if (exactWebsiteFields) exactWebsiteFields.style.display = 'none';
            if (exactGroupFields) exactGroupFields.style.display = 'flex';
        });
    }

    // Exact URL list (single website)
    document.getElementById('addExactUrl').addEventListener('click', () => {
        const url = document.getElementById('exactUrlInput').value.trim();
        if (!url) return;
        if (!exactUrlBlocklist.some(u => typeof u === 'string' ? u === url : false)) {
            exactUrlBlocklist.push(url);
            chrome.storage.local.set({ exactUrlBlocklist }, () => {
                document.getElementById('exactUrlInput').value = '';
                window.showStatus('newExactStatus', 'Exact URL added successfully!');
                renderExactUrls(exactUrlBlocklist);
            });
        }
    });

    // Exact URL list (group)
    const addExactUrlGroupBtn = document.getElementById('addExactUrlGroupBtn');
    if (addExactUrlGroupBtn) {
        addExactUrlGroupBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('exactUrlGroupName');
            const urlsInput = document.getElementById('exactUrlGroupUrls');
            const exclusionsInput = document.getElementById('exactUrlGroupExclusions');

            const name = nameInput ? nameInput.value.trim() : '';
            const urlsStr = urlsInput ? urlsInput.value.trim() : '';
            const exclusionsStr = exclusionsInput ? exclusionsInput.value.trim() : '';

            if (!name) { window.showStatus('newExactStatus', 'Group name is required.', true); return; }
            if (!urlsStr) { window.showStatus('newExactStatus', 'At least one exact URL is required.', true); return; }

            const urls = urlsStr.split(',').map(u => u.trim()).filter(Boolean);
            if (urls.length === 0) { window.showStatus('newExactStatus', 'Invalid URLs.', true); return; }

            const excludedUrls = exclusionsStr.split(',').map(u => u.trim()).filter(Boolean);

            if (exactUrlBlocklist.some(e => e.urls && e.name.toLowerCase() === name.toLowerCase())) {
                window.showStatus('newExactStatus', 'Group name already exists.', true);
                return;
            }

            exactUrlBlocklist.push({
                name,
                urls,
                excludedUrls
            });

            chrome.storage.local.set({ exactUrlBlocklist }, () => {
                if (nameInput) nameInput.value = '';
                if (urlsInput) urlsInput.value = '';
                if (exclusionsInput) exclusionsInput.value = '';
                window.showStatus('newExactStatus', 'Exact URL group added successfully!');
                renderExactUrls(exactUrlBlocklist);
            });
        });
    }

    window.renderExactUrls = function(list) {
        exactUrlBlocklist = list;
        const ul = document.getElementById('exactUrlList');
        if (!ul) return;
        ul.innerHTML = '';
        if (!list.length) { ul.innerHTML = '<li style="color:#64748b;font-style:italic;">No exact URLs configured.</li>'; return; }
        list.slice().reverse().forEach(item => {
            const li = document.createElement('li');
            li.style.flexDirection = 'column';
            li.style.alignItems = 'stretch';

            const mainRow = document.createElement('div');
            mainRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';

            const leftSide = document.createElement('div');
            leftSide.style.display = 'flex';
            leftSide.style.flexDirection = 'column';

            const urlSpan = document.createElement('span');
            urlSpan.style.cssText = 'font-weight:700;font-size:13px;color:#fff;overflow:hidden;text-overflow:ellipsis;';

            if (item && item.urls) {
                urlSpan.textContent = item.name;
                leftSide.appendChild(urlSpan);

                const urlsSpan = document.createElement('small');
                urlsSpan.textContent = `URLs: ${item.urls.join(', ')}`;
                urlsSpan.style.cssText = 'color:#94a3b8; font-size:11px; margin-top:2px; display:block;';
                leftSide.appendChild(urlsSpan);

                if (Array.isArray(item.excludedUrls) && item.excludedUrls.length > 0) {
                    const exclusionsSpan = document.createElement('small');
                    exclusionsSpan.textContent = `Excluded: ${item.excludedUrls.join(', ')}`;
                    exclusionsSpan.style.cssText = 'color:#EF5350; font-size:10px; margin-top:1px; display:block;';
                    leftSide.appendChild(exclusionsSpan);
                }
            } else {
                urlSpan.textContent = item;
                leftSide.appendChild(urlSpan);
            }

            const btn = document.createElement('button');
            btn.textContent = 'remove';
            btn.addEventListener('click', () => {
                exactUrlBlocklist = exactUrlBlocklist.filter(u => {
                    if (item && item.urls) return u.name !== item.name;
                    return u !== item;
                });
                chrome.storage.local.set({ exactUrlBlocklist }, () => renderExactUrls(exactUrlBlocklist));
            });

            mainRow.appendChild(leftSide);
            mainRow.appendChild(btn);
            li.appendChild(mainRow);
            ul.appendChild(li);
        });
    };
}

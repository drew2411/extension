// options-classifications.js — Handles website categorization and time-tracking suggestions

let currentClassifications = {};

function initClassifications() {
    const domainInput = document.getElementById('newClassifyDomain');
    const categorySelect = document.getElementById('newClassifyCategory');
    const addBtn = document.getElementById('addClassifyBtn');
    const searchInput = document.getElementById('classifySearch');

    chrome.storage.local.get(['domainClassifications'], (res) => {
        currentClassifications = res.domainClassifications || {};
        renderClassifications(currentClassifications);
        loadSuggestions();
    });

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const domain = domainInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
            if (!domain) {
                window.showStatus('newClassifyStatus', 'Domain name is required.', true);
                return;
            }
            const category = categorySelect.value;
            
            chrome.storage.local.get(['domainClassifications'], (res) => {
                const classifications = res.domainClassifications || {};
                classifications[domain] = category;
                chrome.storage.local.set({ domainClassifications: classifications }, () => {
                    domainInput.value = '';
                    window.showStatus('newClassifyStatus', 'Website added successfully!');
                });
            });
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderClassifications(currentClassifications);
        });
    }
}

function renderClassifications(classifications) {
    currentClassifications = classifications;
    const listContainer = document.getElementById('categorizedWebsitesList');
    if (!listContainer) return;

    const query = document.getElementById('classifySearch')?.value.toLowerCase().trim() || '';
    listContainer.innerHTML = '';

    const entries = Object.entries(classifications).sort((a, b) => a[0].localeCompare(b[0]));
    const filtered = query ? entries.filter(([domain]) => domain.includes(query)) : entries;

    if (filtered.length === 0) {
        listContainer.innerHTML = '<li class="empty-state">No categorized websites matching your search.</li>';
        return;
    }

    filtered.forEach(([domain, category]) => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.padding = '10px 12px';
        li.style.background = 'rgba(15,23,42,0.3)';
        li.style.borderRadius = '6px';
        li.style.marginBottom = '6px';
        li.style.border = '1px solid rgba(148,163,184,0.1)';

        const textDiv = document.createElement('div');
        textDiv.style.display = 'flex';
        textDiv.style.flexDirection = 'column';

        const domainSpan = document.createElement('span');
        domainSpan.textContent = domain;
        domainSpan.style.fontWeight = '600';
        domainSpan.style.fontSize = '13px';
        domainSpan.style.color = '#fff';

        const catSpan = document.createElement('span');
        catSpan.style.fontSize = '10px';
        catSpan.style.marginTop = '2px';
        catSpan.style.textTransform = 'uppercase';
        catSpan.style.fontWeight = 'bold';
        
        if (category === 'productive') {
            catSpan.textContent = 'productive';
            catSpan.style.color = '#22c55e';
        } else if (category === 'unproductive') {
            catSpan.textContent = 'unproductive';
            catSpan.style.color = '#fb7185';
        } else {
            catSpan.textContent = 'depends on content';
            catSpan.style.color = '#fbbf24';
        }

        textDiv.appendChild(domainSpan);
        textDiv.appendChild(catSpan);

        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.alignItems = 'center';
        actionsDiv.style.gap = '8px';

        // Select element to change category inline
        const select = document.createElement('select');
        select.style.padding = '4px 8px';
        select.style.fontSize = '11px';
        select.style.background = 'rgba(15, 23, 42, 0.6)';
        select.style.color = '#e5e7eb';
        select.style.border = '1px solid rgba(148, 163, 184, 0.2)';
        select.style.borderRadius = '4px';

        const optProd = document.createElement('option');
        optProd.value = 'productive';
        optProd.textContent = 'Productive';
        optProd.selected = category === 'productive';

        const optUnprod = document.createElement('option');
        optUnprod.value = 'unproductive';
        optUnprod.textContent = 'Unproductive';
        optUnprod.selected = category === 'unproductive';

        const optDepends = document.createElement('option');
        optDepends.value = 'depends';
        optDepends.textContent = 'Depends';
        optDepends.selected = category === 'depends';

        select.appendChild(optProd);
        select.appendChild(optUnprod);
        select.appendChild(optDepends);

        select.addEventListener('change', () => {
            chrome.storage.local.get(['domainClassifications'], (res) => {
                const list = res.domainClassifications || {};
                list[domain] = select.value;
                chrome.storage.local.set({ domainClassifications: list });
            });
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Remove';
        delBtn.style.margin = '0';
        delBtn.style.padding = '4px 8px';
        delBtn.style.fontSize = '11px';
        delBtn.style.background = 'transparent';
        delBtn.style.boxShadow = 'none';
        delBtn.style.color = '#64748b';
        delBtn.style.textTransform = 'lowercase';

        delBtn.addEventListener('mouseover', () => { delBtn.style.color = '#FF4081'; });
        delBtn.addEventListener('mouseout', () => { delBtn.style.color = '#64748b'; });

        delBtn.addEventListener('click', () => {
            if (confirm(`Remove classification for ${domain}?`)) {
                chrome.storage.local.get(['domainClassifications'], (res) => {
                    const list = res.domainClassifications || {};
                    delete list[domain];
                    chrome.storage.local.set({ domainClassifications: list });
                });
            }
        });

        actionsDiv.appendChild(select);
        actionsDiv.appendChild(delBtn);

        li.appendChild(textDiv);
        li.appendChild(actionsDiv);
        listContainer.appendChild(li);
    });
}

function loadSuggestions() {
    const card = document.getElementById('classificationSuggestionsCard');
    const listContainer = document.getElementById('classificationSuggestionsList');
    if (!card || !listContainer) return;

    chrome.storage.local.get(['timeHistory', 'domainClassifications'], (res) => {
        const history = res.timeHistory || {};
        const classifications = res.domainClassifications || {};

        // Calculate domain times over last 7 days
        const domainTotals = {};
        Object.values(history).forEach(dayData => {
            Object.entries(dayData).forEach(([domain, secs]) => {
                const d = domain.trim().toLowerCase();
                if (!d || d.includes(':') || d.includes('chrome-extension') || d.includes('localhost') || d === '127.0.0.1') return;
                domainTotals[d] = (domainTotals[d] || 0) + secs;
            });
        });

        // Filter out already categorized domains and domains with total time < 5 minutes (300 seconds)
        const suggestions = Object.entries(domainTotals)
            .filter(([domain, totalSecs]) => !classifications[domain] && totalSecs >= 300)
            .sort((a, b) => b[1] - a[1]);

        if (suggestions.length === 0) {
            card.style.display = 'none';
            return;
        }

        card.style.display = 'block';
        listContainer.innerHTML = '';

        suggestions.slice(0, 5).forEach(([domain, totalSecs]) => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.padding = '10px 12px';
            div.style.background = 'rgba(255, 64, 129, 0.05)';
            div.style.border = '1px solid rgba(255, 64, 129, 0.15)';
            div.style.borderRadius = '8px';
            div.style.fontSize = '12px';

            const textSpan = document.createElement('span');
            textSpan.innerHTML = `<b>${domain}</b> &nbsp;<span style="color:#94a3b8;font-size:11px;">(${window.formatDuration(totalSecs)} this week)</span>`;
            textSpan.style.color = '#e5e7eb';

            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '6px';

            const addCatButton = (label, cat, bgColor) => {
                const btn = document.createElement('button');
                btn.textContent = label;
                btn.style.margin = '0';
                btn.style.padding = '4px 8px';
                btn.style.fontSize = '10px';
                btn.style.fontWeight = 'bold';
                btn.style.background = bgColor;
                btn.style.boxShadow = 'none';
                btn.style.textTransform = 'none';
                
                btn.addEventListener('click', () => {
                    chrome.storage.local.get(['domainClassifications'], (res) => {
                        const list = res.domainClassifications || {};
                        list[domain] = cat;
                        chrome.storage.local.set({ domainClassifications: list }, () => {
                            loadSuggestions();
                        });
                    });
                });
                return btn;
            };

            const prodBtn = addCatButton('Productive', 'productive', '#16a34a');
            const unprodBtn = addCatButton('Unproductive', 'unproductive', '#dc2626');
            const dependsBtn = addCatButton('Depends', 'depends', '#d97706');

            btnGroup.appendChild(prodBtn);
            btnGroup.appendChild(unprodBtn);
            btnGroup.appendChild(dependsBtn);

            div.appendChild(textSpan);
            div.appendChild(btnGroup);
            listContainer.appendChild(div);
        });
    });
}

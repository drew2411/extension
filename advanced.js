// advanced.js

document.addEventListener('DOMContentLoaded', () => {
    const modeRadios = document.querySelectorAll('input[name="mode"]');
    const modeDescription = document.getElementById('modeDescription'); // Added reference
    const blockYoutubeHomepageCheckbox = document.getElementById('blockYoutubeHomepage');
    const blockRedditHomepageCheckbox = document.getElementById('blockRedditHomepage');
    const heuristicDominanceRatioInput = document.getElementById('heuristicDominanceRatio');
    const strictUrlInput = document.getElementById('strictUrlInput');
    const addStrictUrlButton = document.getElementById('addStrictUrl');
    const strictUrlList = document.getElementById('strictUrlList');
    const exactUrlInput = document.getElementById('exactUrlInput');
    const addExactUrlButton = document.getElementById('addExactUrl');
    const exactUrlList = document.getElementById('exactUrlList');

    let strictUrls = [];
    let exactUrls = [];

    chrome.storage.local.get([
        'blockingMode',
        'blockYoutubeHomepage',
        'blockRedditHomepage',
        'strictUrlBlocklist',
        'exactUrlBlocklist',
        'heuristicDominanceRatio'
    ], (result) => {
        const rawMode = result.blockingMode;
        // The mode must be STRICT or LENIENT for the UI, regardless of old 'STRICTEST'
        const mode = (rawMode === 'STRICT' || rawMode === 'STRICTEST') ? 'STRICT' : 'LENIENT';
        
        if (modeRadios && modeRadios.length) {
            modeRadios.forEach(radio => {
                radio.checked = (radio.value === mode);
            });
        }
        
        // FIX 1: Initial description update on load
        updateModeDescriptionUI(mode); 

        if (blockYoutubeHomepageCheckbox) {
            blockYoutubeHomepageCheckbox.checked = !!result.blockYoutubeHomepage;
        }
        if (blockRedditHomepageCheckbox) {
            blockRedditHomepageCheckbox.checked = !!result.blockRedditHomepage;
        }

        const ratio = typeof result.heuristicDominanceRatio === 'number' ? result.heuristicDominanceRatio : 2.0;
        if (heuristicDominanceRatioInput) {
            heuristicDominanceRatioInput.value = ratio;
        }

        strictUrls = Array.isArray(result.strictUrlBlocklist) ? result.strictUrlBlocklist : [];
        exactUrls = Array.isArray(result.exactUrlBlocklist) ? result.exactUrlBlocklist : [];
        renderStrictUrls(strictUrls);
        renderExactUrls(exactUrls);
    });
    
    // Function to update the description text
    function updateModeDescriptionUI(mode) {
        if (!modeDescription) return;
        if (mode === 'STRICT') {
            modeDescription.textContent = 'STRICT - only explicitly productive content';
        } else {
            modeDescription.textContent = 'LENIENT - more generally deemed productive content';
        }
    }

    if (modeRadios && modeRadios.length) {
        modeRadios.forEach(radio => {
            radio.addEventListener('change', (event) => {
                saveCoreAdvancedSettings();
                // FIX 2: Update description immediately when mode changes
                updateModeDescriptionUI(event.target.value); 
            });
        });
    }

    if (blockYoutubeHomepageCheckbox) {
        blockYoutubeHomepageCheckbox.addEventListener('change', saveCoreAdvancedSettings);
    }

    if (blockRedditHomepageCheckbox) {
        blockRedditHomepageCheckbox.addEventListener('change', saveCoreAdvancedSettings);
    }

    if (heuristicDominanceRatioInput) {
        heuristicDominanceRatioInput.addEventListener('change', saveCoreAdvancedSettings);
        heuristicDominanceRatioInput.addEventListener('blur', saveCoreAdvancedSettings);
    }

    function saveCoreAdvancedSettings() {
        const ratioVal = parseFloat(heuristicDominanceRatioInput && heuristicDominanceRatioInput.value);
        const heuristicDominanceRatio = isNaN(ratioVal) || ratioVal < 1 ? 2.0 : ratioVal;
        if (heuristicDominanceRatioInput) {
            heuristicDominanceRatioInput.value = heuristicDominanceRatio;
        }

        const selectedModeRadio = Array.from(modeRadios || []).find(r => r.checked);
        const blockingMode = selectedModeRadio ? selectedModeRadio.value : 'LENIENT';

        chrome.storage.local.set({
            blockingMode,
            heuristicDominanceRatio,
            blockYoutubeHomepage: !!(blockYoutubeHomepageCheckbox && blockYoutubeHomepageCheckbox.checked),
            blockRedditHomepage: !!(blockRedditHomepageCheckbox && blockRedditHomepageCheckbox.checked)
        });
    }
    
    // Function to apply the consistent transparent button styles
    function applyRemoveButtonStyles(button) {
        button.textContent = 'remove';
        button.style.backgroundColor = 'transparent';
        button.style.border = 'none';
        button.style.color = 'white'; 
        button.style.cursor = 'pointer'; 
        button.style.marginLeft = '10px';
        button.style.textTransform = 'lowercase'; 
        button.style.fontWeight = '400';
        button.style.padding = '0'; 
        button.style.fontSize = '12px'; 

        // Add hover/active state handling for visual feedback
        button.addEventListener('mouseover', () => { button.style.color = '#FF4081'; });
        button.addEventListener('mouseout', () => { button.style.color = 'white'; });
        button.addEventListener('mousedown', () => { button.style.color = '#F81F66'; });
        button.addEventListener('mouseup', () => { 
            // Return to hover or default color depending on mouse position
            if (button.matches(':hover')) {
                button.style.color = '#FF4081';
            } else {
                button.style.color = 'white';
            }
        });
    }


    function renderStrictUrls(list) {
        if (!strictUrlList) return;
        strictUrlList.innerHTML = '';
        if (!list || list.length === 0) {
            strictUrlList.innerHTML = '<li style="color: #9ca3af; font-style: italic;">No strict URLs configured.</li>';
            return;
        }
        const ordered = list.slice().reverse();
        ordered.forEach(url => {
            const li = document.createElement('li');
            li.textContent = url;
            const removeButton = document.createElement('button');
            
            // Apply all custom styles
            applyRemoveButtonStyles(removeButton); 

            removeButton.addEventListener('click', () => {
                strictUrls = strictUrls.filter(u => u !== url);
                chrome.storage.local.set({ strictUrlBlocklist: strictUrls }, () => {
                    renderStrictUrls(strictUrls);
                });
            });
            li.appendChild(removeButton);
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
            
            // Apply all custom styles
            applyRemoveButtonStyles(removeButton);

            removeButton.addEventListener('click', () => {
                exactUrls = exactUrls.filter(u => u !== url);
                chrome.storage.local.set({ exactUrlBlocklist: exactUrls }, () => {
                    renderExactUrls(exactUrls);
                });
            });
            li.appendChild(removeButton);
            exactUrlList.appendChild(li);
        });
    }

    if (addStrictUrlButton && strictUrlInput) {
        addStrictUrlButton.addEventListener('click', () => {
            const url = strictUrlInput.value.trim();
            if (!url) return;
            if (!strictUrls.includes(url)) {
                strictUrls.push(url);
                chrome.storage.local.set({ strictUrlBlocklist: strictUrls }, () => {
                    strictUrlInput.value = '';
                    renderStrictUrls(strictUrls);
                });
            } else {
                strictUrlInput.value = '';
            }
        });
    }

    if (addExactUrlButton && exactUrlInput) {
        addExactUrlButton.addEventListener('click', () => {
            const url = exactUrlInput.value.trim();
            if (!url) return;
            if (!exactUrls.includes(url)) {
                exactUrls.push(url);
                chrome.storage.local.set({ exactUrlBlocklist: exactUrls }, () => {
                    exactUrlInput.value = '';
                    renderExactUrls(exactUrls);
                });
            } else {
                exactUrlInput.value = '';
            }
        });
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.strictUrlBlocklist) {
            strictUrls = changes.strictUrlBlocklist.newValue || [];
            renderStrictUrls(strictUrls);
        }
        if (changes.exactUrlBlocklist) {
            exactUrls = changes.exactUrlBlocklist.newValue || [];
            renderExactUrls(exactUrls);
        }
    });
});
// options-settings.js — Settings tab: API key, mode, block action, heuristic ratio

function initSettings() {
    const groqInput   = document.getElementById('groqApiKey');
    const modeRadios  = document.querySelectorAll('input[name="mode"]');
    const modeDesc    = document.getElementById('modeDescription');
    const actionRadios = document.querySelectorAll('input[name="blockAction"]');
    const ratioInput  = document.getElementById('heuristicDominanceRatio');
    const ytReadabilityCheckbox = document.getElementById('useMozillaForYoutube');
    const redditReadabilityCheckbox = document.getElementById('useMozillaForReddit');
    const saveBtn     = document.getElementById('saveSettings');

    chrome.storage.local.get(['groqApiKey', 'blockingMode', 'blockAction', 'heuristicDominanceRatio', 'useMozillaForYoutube', 'useMozillaForReddit'], (res) => {
        if (groqInput && res.groqApiKey) groqInput.value = res.groqApiKey;

        const mode = res.blockingMode === 'STRICT' ? 'STRICT' : 'LENIENT';
        modeRadios.forEach(r => { r.checked = (r.value === mode); });
        updateModeDesc(mode);

        const action = res.blockAction || (mode === 'STRICT' ? 'RICKROLL' : 'GREYSCALE');
        actionRadios.forEach(r => { r.checked = (r.value === action); });

        const ratio = typeof res.heuristicDominanceRatio === 'number' ? res.heuristicDominanceRatio : 3.0;
        if (ratioInput) ratioInput.value = ratio;

        if (ytReadabilityCheckbox) ytReadabilityCheckbox.checked = !!res.useMozillaForYoutube;
        if (redditReadabilityCheckbox) redditReadabilityCheckbox.checked = !!res.useMozillaForReddit;
    });

    modeRadios.forEach(r => r.addEventListener('change', () => updateModeDesc(r.value)));

    function updateModeDesc(mode) {
        if (!modeDesc) return;
        modeDesc.textContent = mode === 'STRICT'
            ? 'STRICT — only explicitly productive content passes through.'
            : 'LENIENT — broadly productive content passes through.';
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const apiKey = groqInput ? groqInput.value.trim() : '';
            if (!apiKey) { window.showStatus('settingsStatus', 'Groq API key is required.', true); return; }

            const selectedMode   = Array.from(modeRadios).find(r => r.checked);
            const selectedAction = Array.from(actionRadios).find(r => r.checked);
            const ratioVal       = parseFloat(ratioInput?.value);
            const useMozillaForYoutube = ytReadabilityCheckbox ? ytReadabilityCheckbox.checked : false;
            const useMozillaForReddit  = redditReadabilityCheckbox ? redditReadabilityCheckbox.checked : false;

            chrome.storage.local.set({
                groqApiKey: apiKey,
                blockingMode: selectedMode  ? selectedMode.value  : 'LENIENT',
                blockAction:  selectedAction ? selectedAction.value : 'GREYSCALE',
                heuristicDominanceRatio: isNaN(ratioVal) || ratioVal < 1 ? 3.0 : ratioVal,
                useMozillaForYoutube,
                useMozillaForReddit
            }, () => {
                window.showStatus('settingsStatus', 'Settings saved!');
            });
        });
    }
}


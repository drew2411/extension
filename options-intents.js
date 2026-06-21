// options-intents.js — Intents Dashboard (Cell system + LLM clarification loop)

function initIntents() {
    let intents = [];
    let advancedMode = false;

    const advToggle = document.getElementById('advancedModeToggle');

    chrome.storage.local.get(['intents', 'advancedMode'], (res) => {
        intents = res.intents || [];
        advancedMode = !!res.advancedMode;
        advToggle.checked = advancedMode;
        renderIntents(intents);
    });

    advToggle.addEventListener('change', () => {
        advancedMode = advToggle.checked;
        chrome.storage.local.set({ advancedMode });
        renderIntents(intents);
    });

    document.getElementById('addProductiveBtn').addEventListener('click', () => {
        addIntent('productive');
    });
    document.getElementById('addUnproductiveBtn').addEventListener('click', () => {
        addIntent('unproductive');
    });
    document.getElementById('addProductiveInput').addEventListener('keydown', e => { if (e.key === 'Enter') addIntent('productive'); });
    document.getElementById('addUnproductiveInput').addEventListener('keydown', e => { if (e.key === 'Enter') addIntent('unproductive'); });

    async function addIntent(category) {
        const inputId = category === 'productive' ? 'addProductiveInput' : 'addUnproductiveInput';
        const input   = document.getElementById(inputId);
        const phrase  = input.value.trim();
        if (!phrase) return;
        input.value = '';

        window.showStatus('intentStatus', `Adding "${phrase}"...`);

        // Create a placeholder cell
        const tempId = `intent_${Date.now()}`;
        const newIntent = { id: tempId, original_phrase: phrase, category, keywords: [], clarification: null, _loading: true };
        intents.push(newIntent);
        renderIntents(intents);

        // Step 1: Check if clarification is needed (passing personaContext and category)
        const personaContext = intents.filter(i => i.id !== tempId && i.original_phrase).map(i => i.original_phrase).join(', ');
        
        chrome.runtime.sendMessage({ type: 'evaluateIntentClarification', phrase, personaContext, category }, async (evalRes) => {
            if (evalRes === null) {
                const idx = intents.findIndex(i => i.id === tempId);
                if (idx >= 0) { intents[idx]._loading = false; intents[idx]._error = "AI Evaluation failed. Check Groq API key."; }
                renderIntents(intents);
                return;
            }
            
            const idx = intents.findIndex(i => i.id === tempId);
            if (idx >= 0) {
                intents[idx].assumedIdentity = evalRes.assumed_identity;
                intents[idx].alternateIdentities = evalRes.alternate_identities || [];
            }
            
            const requires = evalRes?.requires_scope_clarification;
            const question = evalRes?.scope_question;

            if (requires && question) {
                // Show clarification box in cell — personaContext stored on the intent for later use
                if (idx >= 0) { intents[idx]._loading = false; intents[idx]._clarQuestion = question; intents[idx]._personaContext = personaContext; }
                renderIntents(intents);
            } else {
                // Step 2: Generate keywords immediately using assumed identity
                await generateKeywordsForIntent(tempId, phrase, null, category, evalRes.assumed_identity, personaContext);
            }
        });
    }

    async function generateKeywordsForIntent(intentId, phrase, clarification, category, assumedIdentity, personaContext = '') {
        const idx = intents.findIndex(i => i.id === intentId);
        if (idx < 0) return;
        // Recover stored personaContext if it was saved on the intent (clarification path)
        const resolvedPersona = personaContext || intents[idx]._personaContext || '';
        intents[idx]._loading = true;
        intents[idx]._clarQuestion = null;
        if (assumedIdentity) intents[idx].assumedIdentity = assumedIdentity;
        renderIntents(intents);

        chrome.runtime.sendMessage({ type: 'generateIntentKeywords', phrase, clarification, category, assumedIdentity, personaContext: resolvedPersona }, (res) => {
            const i = intents.findIndex(x => x.id === intentId);
            if (i < 0) return;
            
            if (res === null) {
                intents[i]._loading = false;
                intents[i]._error = "Keyword generation failed.";
                renderIntents(intents);
                return;
            }

            const keywords = res?.keywords || [];
            intents[i].keywords = keywords;
            intents[i].clarification = clarification;
            intents[i]._loading = false;
            
            if (res.bonus_intents && Array.isArray(res.bonus_intents) && res.bonus_intents.length > 0) {
                res.bonus_intents.forEach(bonus => {
                    if (!bonus.phrase) return;
                    intents.push({
                        id: `intent_${Date.now()}_${Math.random().toString(36).substring(2)}`,
                        original_phrase: bonus.phrase,
                        category: bonus.category === 'productive' ? 'productive' : 'unproductive',
                        keywords: Array.isArray(bonus.keywords) ? bonus.keywords : [],
                        clarification: "Autonomously generated from context",
                        assumedIdentity: bonus.phrase,
                        _loading: false
                    });
                });
            }
            
            saveIntents();
            window.showStatus('intentStatus', `"${phrase}" added with ${keywords.length} keywords.`);
            renderIntents(intents);
        });
    }

    function removeIntent(intentId) {
        const intent = intents.find(i => i.id === intentId);
        intents = intents.filter(i => i.id !== intentId);
        saveIntents();
        // Trigger shadow list scan if it was unproductive
        if (intent && intent.category === 'unproductive') {
            chrome.runtime.sendMessage({ type: 'intentToggled', intentId });
        }
        renderIntents(intents);
    }

    function removeKeyword(intentId, kw) {
        const idx = intents.findIndex(i => i.id === intentId);
        if (idx < 0) return;
        intents[idx].keywords = intents[idx].keywords.filter(k => k !== kw);
        saveIntents();
        renderIntents(intents);
    }

    function saveIntents() {
        chrome.storage.local.set({ intents });
    }

    // Global so options.js storage listener can call it
    window.renderIntents = function(list) {
        intents = list;
        const prodList  = document.getElementById('productiveList');
        const unprodList = document.getElementById('unproductiveList');
        prodList.innerHTML  = '';
        unprodList.innerHTML = '';

        list.forEach(intent => {
            const el = buildCell(intent);
            if (intent.category === 'productive') prodList.appendChild(el);
            else unprodList.appendChild(el);
        });

        if (!list.some(i => i.category === 'productive'))   prodList.innerHTML  = '<div style="color:#64748b;font-size:12px;font-style:italic;padding:8px;">No productive intents yet.</div>';
        if (!list.some(i => i.category === 'unproductive')) unprodList.innerHTML = '<div style="color:#64748b;font-size:12px;font-style:italic;padding:8px;">No unproductive intents yet.</div>';
        
        lucide.createIcons();
    };

    function buildCell(intent) {
        const cell = document.createElement('div');
        cell.className = 'cell';

        const header = document.createElement('div');
        header.className = 'cell-header';

        const phrase = document.createElement('div');
        phrase.className = 'cell-phrase';
        phrase.textContent = intent.original_phrase;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'cell-remove';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove intent';
        removeBtn.addEventListener('click', () => removeIntent(intent.id));

        header.appendChild(phrase);
        header.appendChild(removeBtn);
        cell.appendChild(header);

        if (intent.assumedIdentity && !intent._loading && !intent._error) {
            const shadowLabel = document.createElement('div');
            shadowLabel.className = 'shadow-label';
            shadowLabel.textContent = `Assuming: ${intent.assumedIdentity}`;
            
            if (intent.alternateIdentities && intent.alternateIdentities.length > 0) {
                const select = document.createElement('select');
                select.className = 'alt-id-select';
                const currentOpt = document.createElement('option');
                currentOpt.value = '';
                currentOpt.textContent = 'Change...';
                currentOpt.disabled = true;
                currentOpt.selected = true;
                select.appendChild(currentOpt);
                
                intent.alternateIdentities.forEach(alt => {
                    if (alt !== intent.assumedIdentity) {
                        const opt = document.createElement('option');
                        opt.value = alt;
                        opt.textContent = alt;
                        select.appendChild(opt);
                    }
                });
                
                select.addEventListener('change', (e) => {
                    const newId = e.target.value;
                    if (newId && newId !== intent.assumedIdentity) {
                        generateKeywordsForIntent(intent.id, intent.original_phrase, intent.clarification, intent.category, newId);
                    }
                });
                
                shadowLabel.appendChild(select);
            }
            cell.appendChild(shadowLabel);
        }

        if (intent._loading) {
            const loading = document.createElement('div');
            loading.style.cssText = 'font-size:11px;color:#94a3b8;margin-top:6px;display:flex;align-items:center;gap:6px;';
            loading.innerHTML = '<i data-lucide="loader" style="width:12px;height:12px;"></i> Generating keywords...';
            cell.appendChild(loading);
            return cell;
        }

        if (intent._error) {
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'font-size:11px;color:#EF5350;margin-top:6px;display:flex;align-items:center;gap:6px;';
            errorDiv.innerHTML = `<i data-lucide="alert-circle" style="width:12px;height:12px;"></i> ${intent._error}`;
            const retryBtn = document.createElement('button');
            retryBtn.textContent = 'Retry';
            retryBtn.style.cssText = 'padding:2px 6px;font-size:9px;margin-left:auto;';
            retryBtn.addEventListener('click', () => {
                removeIntent(intent.id);
                // addIntent helper isn't exported, but we can re-type it or just trigger the logic
                document.getElementById(intent.category === 'productive' ? 'addProductiveInput' : 'addUnproductiveInput').value = intent.original_phrase;
                document.getElementById(intent.category === 'productive' ? 'addProductiveBtn' : 'addUnproductiveBtn').click();
            });
            errorDiv.appendChild(retryBtn);
            cell.appendChild(errorDiv);
            return cell;
        }

        // Clarification box
        if (intent._clarQuestion) {
            const clarBox = document.createElement('div');
            clarBox.className = 'clarification-box';
            clarBox.innerHTML = `<div>${intent._clarQuestion}</div>`;
            const clarInput = document.createElement('input');
            clarInput.type = 'text';
            clarInput.placeholder = 'Your answer...';
            const clarBtn = document.createElement('button');
            clarBtn.textContent = 'Confirm';
            clarBtn.addEventListener('click', () => {
                const answer = clarInput.value.trim() || null;
                // Pass the stored assumedIdentity and personaContext through the clarification path
                generateKeywordsForIntent(intent.id, intent.original_phrase, answer, intent.category, intent.assumedIdentity);
            });
            clarInput.addEventListener('keydown', e => { if (e.key === 'Enter') clarBtn.click(); });
            clarBox.appendChild(clarInput);
            clarBox.appendChild(clarBtn);
            cell.appendChild(clarBox);
            return cell;
        }

        // Keyword count / advanced view
        const kwCount = document.createElement('div');
        kwCount.className = 'cell-kw-count';
        kwCount.textContent = `${intent.keywords?.length || 0} keywords`;
        cell.appendChild(kwCount);

        if (advancedMode && intent.keywords?.length) {
            const kwContainer = document.createElement('div');
            kwContainer.className = 'cell-keywords';
            intent.keywords.forEach(kw => {
                const tag = document.createElement('span');
                tag.className = 'kw-tag';
                tag.textContent = kw;
                const delBtn = document.createElement('button');
                delBtn.textContent = '×';
                delBtn.title = 'Remove keyword';
                delBtn.addEventListener('click', (e) => { e.stopPropagation(); removeKeyword(intent.id, kw); });
                tag.appendChild(delBtn);
                kwContainer.appendChild(tag);
            });

            // Add keyword input
            const addKwRow = document.createElement('div');
            addKwRow.style.cssText = 'display:flex;gap:4px;margin-top:6px;width:100%;';
            const addKwInput = document.createElement('input');
            addKwInput.type = 'text';
            addKwInput.placeholder = '+ keyword';
            addKwInput.style.cssText = 'flex:1;font-size:11px;padding:4px 8px;';
            const addKwBtn = document.createElement('button');
            addKwBtn.textContent = '+';
            addKwBtn.style.cssText = 'padding:4px 8px;font-size:11px;margin:0;';
            const doAdd = () => {
                const kw = addKwInput.value.trim().toLowerCase();
                if (!kw) return;
                const idx = intents.findIndex(i => i.id === intent.id);
                if (idx >= 0 && !intents[idx].keywords.includes(kw)) {
                    intents[idx].keywords.push(kw);
                    saveIntents();
                    renderIntents(intents);
                }
            };
            addKwBtn.addEventListener('click', doAdd);
            addKwInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
            addKwRow.appendChild(addKwInput);
            addKwRow.appendChild(addKwBtn);

            cell.appendChild(kwContainer);
            cell.appendChild(addKwRow);
        }

        return cell;
    }
}

const vscode = window.vscode || acquireVsCodeApi();
const config = window.composeConfig || {};
const isWysiwyg = !!config.isWysiwyg;
const appMode = config.mode || 'compose';

const fieldTo = document.getElementById('fieldTo');
const fieldCc = document.getElementById('fieldCc');
const fieldBcc = document.getElementById('fieldBcc');
const fieldSubject = document.getElementById('fieldSubject');
const wysiwygEditor = document.getElementById('wysiwygEditor');
const previewContent = document.getElementById('previewContent');
const statusText = document.getElementById('statusText');
const btnSend = document.getElementById('btnSend');
const btnSendArchive = document.getElementById('btnSendArchive');
const attachmentList = document.getElementById('attachmentList');
const originalMessageContainer = document.getElementById('original-message-container');
const originalMessageContent = document.getElementById('original-message-content');

// Initial focus on message body
if (isWysiwyg && wysiwygEditor) {
    wysiwygEditor.focus();
    // Move cursor to start
    const range = document.createRange();
    const sel = window.getSelection();
    if (sel) {
        range.setStart(wysiwygEditor, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

// Attachments
const btnAddAttachment = document.getElementById('btnAddAttachment');
const btnAddLocalAttachment = document.getElementById('btnAddLocalAttachment');
const btnAddRemoteAttachment = document.getElementById('btnAddRemoteAttachment');
const localFileInput = document.getElementById('localFileInput');

if (config.isRemote) {
    // Remote mode: hide the standard attach button, show local (via file input) + remote buttons
    btnAddAttachment.classList.add('hidden');
    btnAddLocalAttachment.classList.remove('hidden');
    btnAddRemoteAttachment.classList.remove('hidden');
} else {
    btnAddAttachment.innerHTML = '📎 Attach Files';
}

btnAddAttachment.addEventListener('click', () => {
    vscode.postMessage({ type: 'pickAttachments' });
});

// Local attach via hidden <input type="file"> (always opens local file picker in webview)
btnAddLocalAttachment.addEventListener('click', () => {
    localFileInput.click();
});

localFileInput.addEventListener('change', () => {
    const files = localFileInput.files;
    if (!files || files.length === 0) return;

    let pending = files.length;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = () => {
            // Send base64 content to extension
            const base64 = reader.result.split(',')[1] || '';
            vscode.postMessage({
                type: 'addLocalFile',
                fileName: file.name,
                base64: base64
            });
            pending--;
        };
        reader.readAsDataURL(file);
    }
    // Reset input so the same file can be selected again
    localFileInput.value = '';
});

btnAddRemoteAttachment.addEventListener('click', () => {
    vscode.postMessage({ type: 'pickRemoteAttachments' });
});

// Toggle Cc/Bcc
document.getElementById('toggleCc').addEventListener('click', () => {
    const rowCc = document.getElementById('rowCc');
    const rowBcc = document.getElementById('rowBcc');
    const btn = document.getElementById('toggleCc');
    const isHidden = rowCc.classList.contains('hidden');
    rowCc.classList.toggle('hidden');
    rowBcc.classList.toggle('hidden');
    btn.textContent = isHidden ? 'Hide Cc/Bcc' : 'Show Cc/Bcc';
});

// Autocomplete functionality
function setupAutocomplete(input, list) {
    let currentFocus = -1;
    const contacts = config.contacts || [];

    input.addEventListener('input', function() {
        const val = this.value;
        const cursor = this.selectionStart;
        
        // Find current address being typed (comma separated)
        const addresses = val.split(',');
        let currentPartIndex = 0;
        let cumulativeLen = 0;
        
        for (let i = 0; i < addresses.length; i++) {
            cumulativeLen += addresses[i].length + 1; // +1 for comma
            if (cursor <= cumulativeLen) {
                currentPartIndex = i;
                break;
            }
        }
        
        const currentTyped = addresses[currentPartIndex].trim();
        
        closeAllLists();
        if (!currentTyped || currentTyped.length < 2) return false;
        
        currentFocus = -1;
        list.classList.remove('hidden');
        list.innerHTML = '';
        
        const matches = contacts.filter(c => c.toLowerCase().includes(currentTyped.toLowerCase()));
        
        if (matches.length === 0) {
            list.classList.add('hidden');
            return;
        }
        
        matches.forEach(match => {
            const b = document.createElement('div');
            b.className = 'autocomplete-item';
            
            // Highlight matching part
            const regex = new RegExp("(" + currentTyped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ")", "gi");
            b.innerHTML = typeof escapeHtml === 'function' 
                ? escapeHtml(match).replace(regex, "<strong>$1</strong>")
                : match.replace(regex, "<strong>$1</strong>");
            
            b.addEventListener('click', function() {
                addresses[currentPartIndex] = ' ' + match;
                input.value = addresses.join(',').trim() + ', ';
                closeAllLists();
                input.focus();
            });
            list.appendChild(b);
        });
    });

    input.addEventListener('keydown', function(e) {
        if (list.classList.contains('hidden')) return;
        const items = list.getElementsByClassName('autocomplete-item');
        if (e.keyCode === 40) { // Down
            currentFocus++;
            addActive(items);
            e.preventDefault();
        } else if (e.keyCode === 38) { // Up
            currentFocus--;
            addActive(items);
            e.preventDefault();
        } else if (e.keyCode === 13 || e.keyCode === 9) { // Enter or Tab
            if (currentFocus > -1) {
                items[currentFocus].click();
                e.preventDefault();
            } else if (items.length > 0) {
                items[0].click();
                e.preventDefault();
            }
        }
    });

    function addActive(x) {
        if (!x) return false;
        removeActive(x);
        if (currentFocus >= x.length) currentFocus = 0;
        if (currentFocus < 0) currentFocus = (x.length - 1);
        x[currentFocus].classList.add('active');
        x[currentFocus].scrollIntoView({ block: 'nearest' });
    }
    
    function removeActive(x) {
        for (let i = 0; i < x.length; i++) {
            x[i].classList.remove('active');
        }
    }
    
    function closeAllLists(elmnt) {
        if (elmnt !== input && elmnt !== list) {
            list.classList.add('hidden');
            list.innerHTML = '';
        }
    }
    
    document.addEventListener('click', function (e) {
        closeAllLists(e.target);
    });
}

const autocompleteTo = document.getElementById('autocompleteTo');
const autocompleteCc = document.getElementById('autocompleteCc');
const autocompleteBcc = document.getElementById('autocompleteBcc');

if (fieldTo && autocompleteTo) setupAutocomplete(fieldTo, autocompleteTo);
if (fieldCc && autocompleteCc) setupAutocomplete(fieldCc, autocompleteCc);
if (fieldBcc && autocompleteBcc) setupAutocomplete(fieldBcc, autocompleteBcc);

// WYSIWYG toolbar format buttons
document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        let cmd = btn.dataset.cmd;
        let val = btn.dataset.val || null;
        
        if (cmd === 'fontName' && val === 'monospace') {
            const currentFont = document.queryCommandValue('fontName');
            if (currentFont && currentFont.toLowerCase().includes('monospace')) {
                // Toggle off monospace by setting to inherit fallback
                val = 'inherit';
            }
        }
        
        document.execCommand(cmd, false, val);
        if (wysiwygEditor) wysiwygEditor.focus();
    });
});

// Font size
const fontSizeSelect = document.getElementById('fontSizeSelect');
let lastFontSizeRange = null;
if (fontSizeSelect) {
    fontSizeSelect.addEventListener('mousedown', () => {
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            // Only save if selection is inside editor
            if (wysiwygEditor && wysiwygEditor.contains(range.commonAncestorContainer)) {
                lastFontSizeRange = range.cloneRange();
            }
        }
    });
    fontSizeSelect.addEventListener('change', (e) => {
        if (lastFontSizeRange) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(lastFontSizeRange);
        }
        document.execCommand('fontSize', false, e.target.value);
        if (wysiwygEditor) wysiwygEditor.focus();
        lastFontSizeRange = null;
    });
}

// Switch to Markdown mode
document.getElementById('switchToMd').addEventListener('click', () => {
    if (isWysiwyg) vscode.postMessage({ type: 'switchToMarkdown' });
});
document.getElementById('switchToWysiwyg').addEventListener('click', () => {
    if (!isWysiwyg) vscode.postMessage({ type: 'switchToWysiwyg' });
});


// Send
document.getElementById('btnSend').addEventListener('click', () => {
    const sendMsg = {
        type: 'send',
        to: fieldTo.value,
        cc: fieldCc.value,
        bcc: fieldBcc.value,
        subject: fieldSubject.value,
    };
    if (isWysiwyg && wysiwygEditor) {
        sendMsg.wysiwygHtml = wysiwygEditor.innerHTML;
    }
    vscode.postMessage(sendMsg);
});

if (btnSendArchive) {
    btnSendArchive.addEventListener('click', () => {
        const sendMsg = {
            type: 'sendAndArchive',
            to: fieldTo.value,
            cc: fieldCc.value,
            bcc: fieldBcc.value,
            subject: fieldSubject.value,
        };
        if (isWysiwyg && wysiwygEditor) {
            sendMsg.wysiwygHtml = wysiwygEditor.innerHTML;
        }
        vscode.postMessage(sendMsg);
    });
}

// Discard
document.getElementById('btnDiscard').addEventListener('click', () => {
    vscode.postMessage({ type: 'discard' });
});

// Handle messages from extension
window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
        case 'preview':
            if (previewContent) {
                if (msg.html && msg.html.trim()) {
                    previewContent.innerHTML = msg.html;
                } else {
                    previewContent.innerHTML = '<p class="preview-empty">Start typing in the editor to see a preview…</p>';
                }
            }
            break;
        case 'prefill':
            if (msg.to) fieldTo.value = msg.to;
            if (msg.cc) {
                fieldCc.value = msg.cc;
                document.getElementById('rowCc').classList.remove('hidden');
                document.getElementById('rowBcc').classList.remove('hidden');
                document.getElementById('toggleCc').textContent = 'Hide Cc/Bcc';
            }
            if (msg.subject) fieldSubject.value = msg.subject;
            break;
        case 'originalMessage':
            if (msg.message && originalMessageContainer && originalMessageContent) {
                originalMessageContainer.classList.remove('hidden');
                // Build the header
                const om = msg.message;
                const sepLabel = appMode === 'forward' ? 'Forwarded message' : 'Original message';
                const dateObj = new Date(om.date);
                const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();
                const headerEl = document.getElementById('original-message-header');
                headerEl.innerHTML = '---------- ' + sepLabel + ' ----------<br>' +
                    'From: ' + (om.fromDisplay || '') + '<br>' +
                    'To: ' + (om.toDisplay || '') + '<br>' +
                    'Date: ' + dateStr + '<br>' +
                    'Subject: ' + (om.subject || '');
                // Render original message content indented (skipHeaders=true to avoid duplicate header)
                if (typeof renderMessage === 'function') {
                    renderMessage(originalMessageContent, msg.message, !!msg.showImages, '_orig', true, true, null);
                }
                
                originalMessageContent.addEventListener('requestShowImages', (e) => {
                    const message = e.detail.message;
                    if (typeof renderMessage === 'function') {
                        renderMessage(originalMessageContent, message, true, '_orig', true, true, null);
                    }
                });
            }
            break;
        case 'sending':
            if (btnSend) {
                btnSend.disabled = true;
                btnSend.innerHTML = '<span class="loader" style="margin: 0;"></span>';
            }
            if (btnSendArchive) btnSendArchive.disabled = true;
            if (statusText) {
                statusText.textContent = '';
                statusText.classList.remove('error-text');
            }
            break;
        case 'error':
            if (btnSend) {
                btnSend.disabled = false;
                btnSend.innerHTML = '✉';
            }
            if (btnSendArchive) btnSendArchive.disabled = false;
            if (statusText) {
                statusText.textContent = msg.message;
                statusText.classList.add('error-text');
            }
            break;
        case 'updateAttachments':
            renderAttachments(msg.attachments);
            break;
    }
});

function renderAttachments(list) {
    if (!attachmentList) return;
    attachmentList.innerHTML = '';
    list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'attachment-item';
        div.innerHTML = '<span>' + item.name + '</span>';
        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-att';
        removeBtn.innerHTML = '×';
        removeBtn.title = 'Remove';
        removeBtn.onclick = () => {
           vscode.postMessage({ type: 'removeAttachment', path: item.path });
        };
        div.appendChild(removeBtn);
        attachmentList.appendChild(div);
    });
}

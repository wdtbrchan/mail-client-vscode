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
document.getElementById('btnAddAttachment').addEventListener('click', () => {
    vscode.postMessage({ type: 'pickAttachments' });
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
                const sepLabel = appMode === 'forward' ? 'Forwarded' : 'Original';
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

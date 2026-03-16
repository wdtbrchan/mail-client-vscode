const vscode = acquireVsCodeApi();

const fields = {
    name: document.getElementById('name'),
    senderName: document.getElementById('senderName'),
    host: document.getElementById('host'),
    port: document.getElementById('port'),
    secure: document.getElementById('secure'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    smtpHost: document.getElementById('smtpHost'),
    smtpPort: document.getElementById('smtpPort'),
    smtpSecure: document.getElementById('smtpSecure'),
    smtpUsername: document.getElementById('smtpUsername'),
    smtpPassword: document.getElementById('smtpPassword'),
    sentFolder: document.getElementById('sentFolder'),
    draftsFolder: document.getElementById('draftsFolder'),
    trashFolder: document.getElementById('trashFolder'),
    spamFolder: document.getElementById('spamFolder'),
    archiveFolder: document.getElementById('archiveFolder'),
    newslettersFolder: document.getElementById('newslettersFolder'),
    jiraUrl: document.getElementById('jiraUrl'),
    jiraApiKey: document.getElementById('jiraApiKey'),
    signature: document.getElementById('signature'),
    markdownSignature: document.getElementById('markdownSignature'),
};

const customFoldersContainer = document.getElementById('customFoldersContainer');
const statusEl = document.getElementById('statusMessage');
const titleEl = document.getElementById('formTitle');

let customFolders = [];

function getFormData() {
    // update custom folders from DOM
    const customFolderElements = document.querySelectorAll('.custom-folder-row');
    customFolders = Array.from(customFolderElements).map(row => ({
        name: row.querySelector('.custom-name').value.trim(),
        path: row.querySelector('.custom-path').value
    })).filter(f => f.name);

    return {
        name: fields.name.value.trim(),
        senderName: fields.senderName.value.trim(),
        host: fields.host.value.trim(),
        port: fields.port.value,
        secure: fields.secure.checked,
        username: fields.username.value.trim(),
        password: fields.password.value,
        smtpHost: fields.smtpHost.value.trim(),
        smtpPort: fields.smtpPort.value,
        smtpSecure: fields.smtpSecure.checked,
        smtpUsername: fields.smtpUsername.value.trim(),
        smtpPassword: fields.smtpPassword.value,
        sentFolder: fields.sentFolder.value,
        draftsFolder: fields.draftsFolder.value,
        trashFolder: fields.trashFolder.value,
        spamFolder: fields.spamFolder.value,
        archiveFolder: fields.archiveFolder.value,
        newslettersFolder: fields.newslettersFolder.value,
        customFolders: customFolders,
        jiraUrl: fields.jiraUrl.value.trim(),
        jiraApiKey: fields.jiraApiKey.value.trim(),
        signature: fields.signature.innerHTML,
        markdownSignature: fields.markdownSignature.value
    };
}

function validate() {
    const data = getFormData();
    if (!data.name) { showStatus('Account Name is required.', 'error'); return false; }
    if (!data.host) { showStatus('IMAP Server is required.', 'error'); return false; }
    if (!data.username) { showStatus('Username is required.', 'error'); return false; }
    if (!data.password) { showStatus('Password is required.', 'error'); return false; }
    if (!data.smtpHost) { showStatus('SMTP Server is required.', 'error'); return false; }
    return true;
}

function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status-message ' + type;
    if (!message) {
        statusEl.style.display = 'none';
    } else {
        statusEl.style.display = 'block';
    }
}

function showInlineStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.className = 'status-inline ' + type;
    if (!message) el.className = 'status-inline';
}

function hideStatus() {
    statusEl.className = 'status-message';
    statusEl.style.display = 'none';
}

document.getElementById('btnSave').addEventListener('click', () => {
    if (!validate()) return;
    vscode.postMessage({ type: 'save', data: getFormData() });
});

document.getElementById('btnTest').addEventListener('click', () => {
    if (!validate()) return;
    showInlineStatus('imapTestStatus', 'Testing...', 'loading');
    showStatus('', ''); // clear global
    document.getElementById('btnTest').disabled = true;
    vscode.postMessage({ type: 'testConnection', data: getFormData() });
});

document.getElementById('btnTestSmtp').addEventListener('click', () => {
    if (!validate()) return;
    showInlineStatus('smtpTestStatus', 'Testing...', 'loading');
    showStatus('', ''); // clear global
    document.getElementById('btnTestSmtp').disabled = true;
    vscode.postMessage({ type: 'testSmtpConnection', data: getFormData() });
});

document.getElementById('btnListFolders').addEventListener('click', () => {
    if (!fields.host.value || !fields.username.value || !fields.password.value) {
        showInlineStatus('loadFoldersStatus', 'Please fill in Host, Username and Password to list folders.', 'error');
        return;
    }
    showInlineStatus('loadFoldersStatus', 'Listing folders...', 'loading');
    document.getElementById('btnListFolders').disabled = true;
    vscode.postMessage({ type: 'listFolders', data: getFormData() });
});

document.getElementById('btnCancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
});

document.getElementById('btnAddCustomFolder').addEventListener('click', () => {
    addCustomFolderRow('', '');
});

function addCustomFolderRow(name, path, options = []) {
    const row = document.createElement('div');
    row.className = 'form-group custom-folder-row';
    row.style.marginBottom = '8px';

    let optionsHtml = '';
    if (options.length > 0) {
        optionsHtml = options.map(f => '<option value="' + f + '" ' + (f === path ? 'selected' : '') + '>' + f + '</option>').join('');
    } else {
        optionsHtml = '<option value="' + path + '">' + (path || 'Select folder...') + '</option>';
    }

    row.innerHTML = `
        <input type="text" class="custom-name custom-name-width" placeholder="Name (e.g. Work)" value="${name}">
        <select class="custom-path folder-select flex-1">${optionsHtml}</select>
        <button type="button" class="btn-secondary padding-small" onclick="this.parentElement.remove()">X</button>
    `;
    row.classList.add('flex-row', 'flex-gap-10');

    customFoldersContainer.appendChild(row);
}

// Setup WYSIWYG formatting buttons for signature
document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cmd = btn.getAttribute('data-cmd');
        document.execCommand(cmd, false, null);
        fields.signature.focus();
    });
});

function populateFolderSelects(folders) {
    const selectors = [
        fields.sentFolder, fields.draftsFolder, fields.trashFolder,
        fields.spamFolder, fields.archiveFolder, fields.newslettersFolder
    ];

    const updateSelect = (select) => {
        const current = select.value;
        select.innerHTML = '';

        folders.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            select.appendChild(opt);
        });

        if (folders.includes(current)) {
            select.value = current;
        } else {
            const lowerId = select.id.toLowerCase();
            const match = folders.find(f => lowerId.includes(f.toLowerCase()) || f.toLowerCase().includes(lowerId.replace('folder', '')));
            if (match) select.value = match;
        }
    };

    selectors.forEach(updateSelect);

    // Also update custom folder dropdowns
    document.querySelectorAll('.custom-path').forEach(select => {
        const current = select.value;
        select.innerHTML = folders.map(f => '<option value="' + f + '">' + f + '</option>').join('');
        if (folders.includes(current)) select.value = current;
    });

    // Store folders for new custom rows
    window.availableFolders = folders;
}

window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
        case 'loadAccount':
            titleEl.textContent = 'Edit: ' + message.account.name;
            fields.name.value = message.account.name || '';
            fields.senderName.value = message.account.senderName || '';
            fields.host.value = message.account.host || '';
            fields.port.value = message.account.port || 993;
            fields.secure.checked = message.account.secure !== false;
            fields.username.value = message.account.username || '';
            fields.password.value = message.account.password || '';
            fields.smtpHost.value = message.account.smtpHost || '';
            fields.smtpPort.value = message.account.smtpPort || 465;
            fields.smtpSecure.checked = message.account.smtpSecure !== false;
            fields.smtpUsername.value = message.account.smtpUsername || '';
            fields.smtpPassword.value = message.account.smtpPassword || '';

            const setFolder = (field, value) => {
                field.innerHTML = '<option value="' + value + '">' + value + '</option>';
                field.value = value;
            };

            setFolder(fields.sentFolder, message.account.sentFolder || 'Sent');
            setFolder(fields.draftsFolder, message.account.draftsFolder || 'Drafts');
            setFolder(fields.trashFolder, message.account.trashFolder || 'Trash');
            setFolder(fields.spamFolder, message.account.spamFolder || 'Spam');
            setFolder(fields.archiveFolder, message.account.archiveFolder || 'Archive');
            setFolder(fields.newslettersFolder, message.account.newslettersFolder || 'Newsletters');
            fields.jiraUrl.value = message.account.jiraUrl || '';
            fields.jiraApiKey.value = message.account.jiraApiKey || '';
            fields.signature.innerHTML = message.account.signature || '';
            fields.markdownSignature.value = message.account.markdownSignature || '';

            customFoldersContainer.innerHTML = '';
            if (message.account.customFolders) {
                message.account.customFolders.forEach(cf => {
                    addCustomFolderRow(cf.name, cf.path);
                });
            }
            break;
        case 'testResult':
            document.getElementById('btnTest').disabled = false;
            showInlineStatus('imapTestStatus', message.message, message.success ? 'success' : 'error');
            break;
        case 'testSmtpResult':
            document.getElementById('btnTestSmtp').disabled = false;
            showInlineStatus('smtpTestStatus', message.message, message.success ? 'success' : 'error');
            break;
        case 'foldersList':
            document.getElementById('btnListFolders').disabled = false;
            if (message.success) {
                showInlineStatus('loadFoldersStatus', 'Folders loaded.', 'success');
                populateFolderSelects(message.folders);
            } else {
                showInlineStatus('loadFoldersStatus', 'Failed to list folders: ' + message.error, 'error');
            }
            break;
        case 'saveResult':
            if (message.success) {
                showStatus('Account saved successfully!', 'success');
            } else {
                showStatus(message.error || 'Failed to save.', 'error');
            }
            break;
    }
});

import * as vscode from 'vscode';
import { AccountManager } from '../services/accountManager';
import { ImapService } from '../services/imapService';
import { SmtpService } from '../services/smtpService';
import { IMailAccount } from '../types/account';

/**
 * Webview panel for editing/creating IMAP account settings.
 * Shows a form with fields for connection configuration.
 */
export class AccountSettingsPanel {
    public static readonly viewType = 'mailClient.accountSettings';
    private static currentPanel: AccountSettingsPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly accountManager: AccountManager,
        private readonly extensionUri: vscode.Uri,
        private readonly existingAccount?: IMailAccount,
    ) {
        this.panel = panel;
        this.panel.webview.html = this.getHtmlContent();

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables,
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // If editing, send existing account data to webview
        if (existingAccount) {
            this.sendAccountData(existingAccount);
        }
    }

    /**
     * Opens the account settings panel.
     * @param account - If provided, opens in edit mode with pre-filled data
     */
    static show(
        accountManager: AccountManager,
        extensionUri: vscode.Uri,
        account?: IMailAccount,
    ): void {
        const column = vscode.ViewColumn.One;

        // Reuse existing panel if available
        if (AccountSettingsPanel.currentPanel) {
            AccountSettingsPanel.currentPanel.panel.reveal(column);
            if (account) {
                AccountSettingsPanel.currentPanel.sendAccountData(account);
            }
            return;
        }

        const title = account ? `Edit: ${account.name}` : 'New Mail Account';
        const panel = vscode.window.createWebviewPanel(
            AccountSettingsPanel.viewType,
            title,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        AccountSettingsPanel.currentPanel = new AccountSettingsPanel(
            panel,
            accountManager,
            extensionUri,
            account,
        );
    }

    private async sendAccountData(account: IMailAccount): Promise<void> {
        const password = await this.accountManager.getPassword(account.id);
        const smtpPassword = await this.accountManager.getSmtpPassword(account.id);
        this.panel.webview.postMessage({
            type: 'loadAccount',
            account: {
                ...account,
                password: password || '',
                smtpPassword: smtpPassword || '',
            },
        });
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'save':
                await this.handleSave(message.data);
                break;
            case 'testConnection':
                await this.handleTestConnection(message.data);
                break;
            case 'testSmtpConnection':
                await this.handleTestSmtpConnection(message.data);
                break;
            case 'cancel':
                this.panel.dispose();
                break;
            case 'listFolders':
                await this.handleListFolders(message.data);
                break;
        }
    }

    private async handleSave(data: any): Promise<void> {
        try {
            const account: IMailAccount = {
                id: this.existingAccount?.id || this.accountManager.generateId(),
                name: data.name,
                senderName: data.senderName || undefined,
                host: data.host,
                port: parseInt(data.port, 10),
                secure: data.secure,
                username: data.username,
                smtpHost: data.smtpHost,
                smtpPort: parseInt(data.smtpPort, 10),
                smtpSecure: data.smtpSecure,
                smtpUsername: data.smtpUsername || undefined,
                sentFolder: data.sentFolder || 'Sent',
                draftsFolder: data.draftsFolder || 'Drafts',
                trashFolder: data.trashFolder || 'Trash',
                spamFolder: data.spamFolder || 'Spam',
                archiveFolder: data.archiveFolder || 'Archive',
                newslettersFolder: data.newslettersFolder || 'Newsletters',
                customFolders: data.customFolders || [],
                signature: data.signature || undefined,
                markdownSignature: data.markdownSignature || undefined,
            };

            const smtpPassword = data.smtpPassword || undefined;

            if (this.existingAccount) {
                await this.accountManager.updateAccount(account, data.password, smtpPassword);
            } else {
                await this.accountManager.addAccount(account, data.password, smtpPassword);
            }

            this.panel.webview.postMessage({
                type: 'saveResult',
                success: true,
            });

            // Close the panel after a short delay
            setTimeout(() => this.panel.dispose(), 500);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to save account';
            this.panel.webview.postMessage({
                type: 'saveResult',
                success: false,
                error: errorMsg,
            });
        }
    }

    private async handleTestConnection(data: any): Promise<void> {
        try {
            const account: IMailAccount = {
                id: 'test',
                name: data.name,
                host: data.host,
                port: parseInt(data.port, 10),
                secure: data.secure,
                username: data.username,
                smtpHost: data.smtpHost || '',
                smtpPort: parseInt(data.smtpPort, 10) || 465,
                smtpSecure: data.smtpSecure !== false,
            };

            await ImapService.testConnection(account, data.password);

            this.panel.webview.postMessage({
                type: 'testResult',
                success: true,
                message: 'Connection successful!',
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Connection failed';
            this.panel.webview.postMessage({
                type: 'testResult',
                success: false,
                message: `Connection failed: ${errorMsg}`,
            });
        }
    }

    private async handleTestSmtpConnection(data: any): Promise<void> {
        try {
            const account: IMailAccount = {
                id: 'test_smtp',
                name: data.name,
                host: data.host,
                port: parseInt(data.port, 10),
                secure: data.secure,
                username: data.username,
                smtpHost: data.smtpHost || '',
                smtpPort: parseInt(data.smtpPort, 10) || 465,
                smtpSecure: data.smtpSecure !== false,
                smtpUsername: data.smtpUsername || undefined,
            };

            await SmtpService.testConnection(account, data.smtpPassword || data.password);

            this.panel.webview.postMessage({
                type: 'testSmtpResult',
                success: true,
                message: 'SMTP connection successful!',
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'SMTP connection failed';
            this.panel.webview.postMessage({
                type: 'testSmtpResult',
                success: false,
                message: `SMTP failed: ${errorMsg}`,
            });
        }
    }

    private async handleListFolders(data: any): Promise<void> {
        try {
            const account: IMailAccount = {
                id: 'temp',
                name: data.name,
                host: data.host,
                port: parseInt(data.port, 10),
                secure: data.secure,
                username: data.username,
                // SMTP not needed for listing folders
                smtpHost: '',
                smtpPort: 0,
                smtpSecure: false
            };

            const service = new ImapService();
            await service.connect(account, data.password);
            const folders = await service.listFolderPaths();
            await service.disconnect();

            this.panel.webview.postMessage({
                type: 'foldersList',
                success: true,
                folders: folders.sort()
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to list folders';
            this.panel.webview.postMessage({
                type: 'foldersList',
                success: false,
                error: errorMsg
            });
        }
    }

    private getHtmlContent(): string {
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Settings</title>
    <style nonce="${nonce}">
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }
        .form-container {
            max-width: 500px;
            margin: 0 auto;
        }
        h1 {
            font-size: 1.4em;
            font-weight: 600;
            margin-bottom: 24px;
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 12px;
        }
        .form-group {
            display: grid;
            grid-template-columns: 140px 1fr;
            align-items: center;
            margin-bottom: 14px;
            gap: 12px;
        }
        .form-group.checkbox-group {
            align-items: center;
        }
        label {
            font-weight: 500;
            color: var(--vscode-foreground);
            text-align: right;
        }
        input[type="text"],
        input[type="password"],
        input[type="number"] {
            width: 100%;
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-family: inherit;
            font-size: inherit;
            outline: none;
        }
    input:focus, select:focus {
            border-color: var(--vscode-focusBorder);
        }
        select {
            width: 100%;
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-family: inherit;
            font-size: inherit;
            outline: none;
        }
        input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: var(--vscode-checkbox-background);
        }
        .checkbox-label {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .button-row {
            display: flex;
            gap: 10px;
            margin-top: 24px;
            justify-content: flex-end;
        }
        button {
            padding: 8px 18px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-family: inherit;
            font-size: inherit;
            font-weight: 500;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .btn-test {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border, transparent);
        }
        .btn-test:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .status-message {
            margin-top: 16px;
            padding: 10px 14px;
            border-radius: 4px;
            display: none;
            font-size: 0.95em;
        }
        .status-message.success {
            display: block;
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            color: var(--vscode-foreground);
        }
        .status-message.error {
            display: block;
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-foreground);
        }
        .status-message.loading {
            display: block;
            background: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            color: var(--vscode-foreground);
        }
        .status-inline {
            font-size: 0.9em;
            display: inline-block;
        }
        .status-inline.success { color: var(--vscode-testing-iconPassed); }
        .status-inline.error { color: var(--vscode-testing-iconFailed); }
        .status-inline.loading { color: var(--vscode-descriptionForeground); }
        .validation-error {
            color: var(--vscode-errorForeground);
            font-size: 0.85em;
            margin-top: 4px;
            grid-column: 2;
        }
        .section-divider {
            border: none;
            border-top: 1px solid var(--vscode-widget-border);
            margin: 20px 0;
        }
        .section-title {
            font-size: 1.1em;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--vscode-foreground);
            opacity: 0.85;
        }
        .wysiwyg-toolbar {
            display: flex;
            gap: 4px;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            border-bottom: none;
            border-radius: 4px 4px 0 0;
            background: var(--vscode-editorWidget-background);
        }
        .format-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 0.9em;
            font-weight: 600;
        }
        .flex-row {
            display: flex;
            align-items: center;
        }
        .flex-gap-10 { gap: 10px; }
        .justify-between { justify-content: space-between; }
        .width-auto { width: auto; }
        .width-fit { width: fit-content; }
        .white-space-nowrap { white-space: nowrap; }
        .padding-small { padding: 4px 10px; }
        .margin-left-10 { margin-left: 10px; }
        .margin-bottom-8 { margin-bottom: 8px; }
        .margin-bottom-16 { margin-bottom: 16px; }
        .margin-bottom-24 { margin-bottom: 24px; }
        .margin-top-16 { margin-top: 16px; }
        .margin-top-32 { margin-top: 32px; }
        .font-small { font-size: 0.9em; }
        .color-description { color: var(--vscode-descriptionForeground); }
        .font-weight-500 { font-weight: 500; }
        .display-block { display: block; }
        .text-left { text-align: left; }
        .spacer-32 { height: 32px; width: 100%; }
        .cursor-pointer { cursor: pointer; }
        .display-list-item { display: list-item; }
        .custom-name-width { width: 140px; }
        .flex-1 { flex: 1; }
        .format-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        .wysiwyg-editor {
            min-height: 120px;
            padding: 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 0 0 4px 4px;
            background: #ffffff;
            color: #000000;
            outline: none;
            line-height: 1.5;
            overflow-y: auto;
        }
        .markdown-editor {
            width: 100%;
            min-height: 200px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            padding: 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            outline: none;
            resize: vertical;
            box-sizing: border-box;
            line-height: 1.5;
        }
        .markdown-editor:focus {
            border-color: var(--vscode-focusBorder);
        }
        .wysiwyg-editor ul, .wysiwyg-editor ol {
            padding-left: 24px;
            margin: 6px 0;
        }
        .wysiwyg-editor:focus {
            border-color: var(--vscode-focusBorder);
        }
    </style>
</head>
<body>
    <div class="form-container">
        <h1 id="formTitle">New Mail Account</h1>

        <div class="form-group">
            <label for="name">Account Name</label>
            <input type="text" id="name" placeholder="My Email" required>
        </div>
        <div class="form-group">
            <label for="senderName">Sender Name</label>
            <input type="text" id="senderName" placeholder="John Doe">
        </div>

        <hr class="section-divider">

        <div class="form-group">
            <label for="host">IMAP Server</label>
            <input type="text" id="host" placeholder="imap.example.com" required>
        </div>
        <div class="form-group">
            <label for="port">Port</label>
            <input type="number" id="port" value="993" min="1" max="65535">
        </div>
        <div class="form-group checkbox-group">
            <label for="secure">SSL/TLS</label>
            <div class="checkbox-label">
                <input type="checkbox" id="secure" checked>
                <span>Use secure connection</span>
            </div>
        </div>

        <hr class="section-divider">

        <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" placeholder="user@example.com" required>
        </div>
        <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" placeholder="••••••••" required>
        </div>
        <div class="form-group">
            <label></label>
            <div class="flex-row flex-gap-10">
                <button class="btn-test width-fit" id="btnTest" type="button">Test Connection</button>
                <span id="imapTestStatus" class="status-inline"></span>
            </div>
        </div>

        <hr class="section-divider">
        <h2 class="section-title">SMTP (Outgoing Mail)</h2>

        <div class="form-group">
            <label for="smtpHost">SMTP Server</label>
            <input type="text" id="smtpHost" placeholder="smtp.example.com" required>
        </div>
        <div class="form-group">
            <label for="smtpPort">Port</label>
            <input type="number" id="smtpPort" value="465" min="1" max="65535">
        </div>
        <div class="form-group checkbox-group">
            <label for="smtpSecure">SSL/TLS</label>
            <div class="checkbox-label">
                <input type="checkbox" id="smtpSecure" checked>
                <span>Use secure connection</span>
            </div>
        </div>

        <hr class="section-divider">

        <div class="form-group">
            <label for="smtpUsername">SMTP Username</label>
            <input type="text" id="smtpUsername" placeholder="Leave empty = same as IMAP">
        </div>
        <div class="form-group">
            <label for="smtpPassword">SMTP Password</label>
            <input type="password" id="smtpPassword" placeholder="Leave empty = same as IMAP">
        </div>
        <div class="form-group">
            <label></label>
            <div class="flex-row flex-gap-10">
                <button class="btn-test width-fit" id="btnTestSmtp" type="button">Test SMTP Connection</button>
                <span id="smtpTestStatus" class="status-inline"></span>
            </div>
        </div>

        <hr class="section-divider">

        <hr class="section-divider">
        <details>
            <summary class="section-title cursor-pointer display-list-item">Folders</summary>
            <div class="margin-top-16">
                <div class="flex-row flex-gap-10 margin-bottom-8">
                    <button class="btn-test white-space-nowrap padding-small font-small" id="btnListFolders" type="button">Load Folders</button>
                    <span id="loadFoldersStatus" class="status-inline"></span>
                </div>                
                <div class="margin-bottom-16 color-description font-small">
                    Map server folders to local functions. Settings take effect after connection.
                </div>

        <div class="form-group">
            <label for="sentFolder">Sent</label>
            <select id="sentFolder" class="folder-select"><option value="Sent">Sent</option></select>
        </div>
        <div class="form-group">
            <label for="draftsFolder">Drafts</label>
            <select id="draftsFolder" class="folder-select"><option value="Drafts">Drafts</option></select>
        </div>
        <div class="form-group">
            <label for="trashFolder">Trash</label>
            <select id="trashFolder" class="folder-select"><option value="Trash">Trash</option></select>
        </div>
        <div class="form-group">
            <label for="spamFolder">Spam</label>
            <select id="spamFolder" class="folder-select"><option value="Spam">Spam</option></select>
        </div>
        <div class="form-group">
            <label for="archiveFolder">Archive</label>
            <select id="archiveFolder" class="folder-select"><option value="Archive">Archive</option></select>
        </div>
        <div class="form-group">
            <label for="newslettersFolder">Newsletters</label>
            <select id="newslettersFolder" class="folder-select"><option value="Newsletters">Newsletters</option></select>
        </div>
        
        <div class="form-group">
            <label>Custom Folders</label>
            <div id="customFoldersContainer">
                <!-- Custom folders will be added here -->
            </div>
        </div>
        <div class="form-group">
            <label></label>
            <button class="btn-secondary width-auto" id="btnAddCustomFolder" type="button">+ Add Custom Folder</button>
        </div>
            </div>
        </details>

        <hr class="section-divider">
        <details>
            <summary class="section-title cursor-pointer display-list-item">Signatures</summary>
            <div class="margin-top-16">
                <div class="margin-bottom-16">
            <label class="display-block text-left font-weight-500 margin-bottom-8" style="color: var(--vscode-foreground);">HTML Signature (WYSIWYG)</label>
            <div class="wysiwyg-toolbar">
                <button type="button" class="format-btn" data-cmd="bold" title="Bold"><b>B</b></button>
                <button type="button" class="format-btn" data-cmd="italic" title="Italic"><i>I</i></button>
                <button type="button" class="format-btn" data-cmd="underline" title="Underline"><u>U</u></button>
                <button type="button" class="format-btn" data-cmd="insertUnorderedList" title="Bullet List">• List</button>
                <button type="button" class="format-btn" data-cmd="insertOrderedList" title="Numbered List">1. List</button>
            </div>
            <div class="wysiwyg-editor" contenteditable="true" id="signature"></div>
        </div>
        
        <div class="spacer-32"></div>

        <div class="margin-bottom-24">
            <label class="display-block text-left font-weight-500 margin-bottom-8" style="color: var(--vscode-foreground);">Markdown Signature</label>
            <textarea id="markdownSignature" class="markdown-editor" placeholder="Type markdown signature here..."></textarea>
        </div>
            </div>
        </details>

        <div class="button-row">
            <button class="btn-secondary" id="btnCancel" type="button">Cancel</button>
            <button class="btn-primary" id="btnSave" type="button">Save</button>
        </div>

        <div id="statusMessage" class="status-message"></div>
    </div>

    <script nonce="${nonce}">
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

            row.innerHTML = \`
                <input type="text" class="custom-name custom-name-width" placeholder="Name (e.g. Work)" value="\${name}">
                <select class="custom-path folder-select flex-1">\${optionsHtml}</select>
                <button type="button" class="btn-secondary padding-small" onclick="this.parentElement.remove()">X</button>
            \`;
            // rely on flex class wrapper instead of inline styles
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
            
            // Helper to preserve current selection if possible
            const updateSelect = (select) => {
                const current = select.value;
                select.innerHTML = '';
                // Add default/common options first if desired, or just the list
                // We'll add a 'None' or empty option maybe? The user wants to map folders.
                
                // Add the folders from server
                folders.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f;
                    opt.textContent = f;
                    select.appendChild(opt);
                });
                
                // Restore selection or defaults
                if (folders.includes(current)) {
                    select.value = current;
                } else {
                    // Try to auto-match common names
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
                    
                    // Handle folders
                    // We might not have the folder list yet, so just add the saved value as an option
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
                    fields.signature.innerHTML = message.account.signature || '';
                    fields.markdownSignature.value = message.account.markdownSignature || '';

                    // Custom folders
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
    </script>
</body>
</html>`;
    }

    private dispose(): void {
        AccountSettingsPanel.currentPanel = undefined;
        this.panel.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

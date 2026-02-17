import * as vscode from 'vscode';
import { AccountManager } from '../services/accountManager';
import { ImapService } from '../services/imapService';
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
            case 'cancel':
                this.panel.dispose();
                break;
        }
    }

    private async handleSave(data: any): Promise<void> {
        try {
            const account: IMailAccount = {
                id: this.existingAccount?.id || this.accountManager.generateId(),
                name: data.name,
                host: data.host,
                port: parseInt(data.port, 10),
                secure: data.secure,
                username: data.username,
                smtpHost: data.smtpHost,
                smtpPort: parseInt(data.smtpPort, 10),
                smtpSecure: data.smtpSecure,
                smtpUsername: data.smtpUsername || undefined,
                sentFolder: data.sentFolder || 'Sent',
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
        input:focus {
            border-color: var(--vscode-focusBorder);
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
    </style>
</head>
<body>
    <div class="form-container">
        <h1 id="formTitle">New Mail Account</h1>

        <div class="form-group">
            <label for="name">Account Name</label>
            <input type="text" id="name" placeholder="My Email" required>
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

        <hr class="section-divider">

        <div class="form-group">
            <label for="sentFolder">Sent Folder</label>
            <input type="text" id="sentFolder" placeholder="Default: Sent">
        </div>

        <div class="button-row">
            <button class="btn-test" id="btnTest" type="button">Test Connection</button>
            <button class="btn-secondary" id="btnCancel" type="button">Cancel</button>
            <button class="btn-primary" id="btnSave" type="button">Save</button>
        </div>

        <div id="statusMessage" class="status-message"></div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        const fields = {
            name: document.getElementById('name'),
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
        };

        const statusEl = document.getElementById('statusMessage');
        const titleEl = document.getElementById('formTitle');

        function getFormData() {
            return {
                name: fields.name.value.trim(),
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
                sentFolder: fields.sentFolder.value.trim(),
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
        }

        function hideStatus() {
            statusEl.className = 'status-message';
        }

        document.getElementById('btnSave').addEventListener('click', () => {
            if (!validate()) return;
            vscode.postMessage({ type: 'save', data: getFormData() });
        });

        document.getElementById('btnTest').addEventListener('click', () => {
            if (!validate()) return;
            showStatus('Testing connection...', 'loading');
            document.getElementById('btnTest').disabled = true;
            vscode.postMessage({ type: 'testConnection', data: getFormData() });
        });

        document.getElementById('btnCancel').addEventListener('click', () => {
            vscode.postMessage({ type: 'cancel' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.type) {
                case 'loadAccount':
                    titleEl.textContent = 'Edit: ' + message.account.name;
                    fields.name.value = message.account.name || '';
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
                    fields.sentFolder.value = message.account.sentFolder || 'Sent';
                    break;
                case 'testResult':
                    document.getElementById('btnTest').disabled = false;
                    showStatus(message.message, message.success ? 'success' : 'error');
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

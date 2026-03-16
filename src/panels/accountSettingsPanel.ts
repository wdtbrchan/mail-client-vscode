import * as vscode from 'vscode';
import { AccountManager } from '../services/accountManager';
import { ImapService } from '../services/imapService';
import { SmtpService } from '../services/smtpService';
import { IMailAccount } from '../types/account';

// @ts-ignore
import accountSettingsHtml from './views/accountSettings/accountSettings.html';
// @ts-ignore
import accountSettingsCss from './views/accountSettings/accountSettings.css';
// @ts-ignore
import accountSettingsJs from './views/accountSettings/accountSettings.js';

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
                jiraUrl: data.jiraUrl || undefined,
                jiraApiKey: data.jiraApiKey || undefined,
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
        return accountSettingsHtml
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace('/* {{CSS_INJECT}} */', accountSettingsCss)
            .replace('// {{JS_INJECT}}', accountSettingsJs);
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

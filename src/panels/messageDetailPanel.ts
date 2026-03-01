import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { MailExplorerProvider } from '../providers/mailExplorerProvider';
import { AccountManager } from '../services/accountManager';
import { MessageListPanel } from './messageListPanel';
import { IMailMessageDetail } from '../types/message';
import { getSharedStyles, getSharedScripts } from './utils/webviewContent';

/**
 * Webview panel for displaying a full email message with reply capabilities.
 * Shows message headers, HTML/text body, and a WYSIWYG reply editor.
 */
export class MessageDetailPanel {
    public static readonly viewType = 'mailClient.messageDetail';
    private static panels = new Map<string, MessageDetailPanel>();
    private static splitPanel: MessageDetailPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly explorerProvider: MailExplorerProvider,
        private readonly accountManager: AccountManager,
        private accountId: string,
        private folderPath: string,
        private uid: number,
        public readonly isEmbedded: boolean = false,
        private readonly onBack?: () => void,
    ) {
        this.panel = panel;

        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables,
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.loadMessage();
    }

    /**
     * Opens or reveals a message detail panel.
     */
    static show(
        explorerProvider: MailExplorerProvider,
        accountManager: AccountManager,
        accountId: string,
        folderPath: string,
        uid: number,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.One
    ): MessageDetailPanel {
        const key = `${accountId}:${folderPath}:${uid}`;

        const existing = MessageDetailPanel.panels.get(key);
        if (existing) {
            existing.panel.reveal(viewColumn);
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            MessageDetailPanel.viewType,
            'Loading...',
            viewColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        const instance = new MessageDetailPanel(panel, explorerProvider, accountManager, accountId, folderPath, uid);
        MessageDetailPanel.panels.set(key, instance);
        return instance;
    }

    /**
     * Opens or reveals a message detail panel in a reusable split view.
     */
    static showInSplit(
        explorerProvider: MailExplorerProvider,
        accountManager: AccountManager,
        accountId: string,
        folderPath: string,
        uid: number,
    ): MessageDetailPanel {
        const key = `${accountId}:${folderPath}:${uid}`;
        const existing = MessageDetailPanel.panels.get(key);

        if (MessageDetailPanel.splitPanel) {
            const active = MessageDetailPanel.splitPanel;
            // If the same message is already in split panel, just reveal
            if (active.uid === uid && active.folderPath === folderPath && active.accountId === accountId) {
                 active.panel.reveal(active.panel.viewColumn || vscode.ViewColumn.Beside, true);
                 return active;
            }

            // Remove old key from panels map
            const oldKey = `${active.accountId}:${active.folderPath}:${active.uid}`;
            MessageDetailPanel.panels.delete(oldKey);

            // Update to new message
            active.accountId = accountId;
            active.folderPath = folderPath;
            active.uid = uid;
            
            // Register under new key
            MessageDetailPanel.panels.set(key, active);
            
            active.panel.reveal(active.panel.viewColumn || vscode.ViewColumn.Beside, true);
            active.loadMessage();
            return active;
        }

        if (existing) {
             existing.panel.reveal(vscode.ViewColumn.Beside, true);
             MessageDetailPanel.splitPanel = existing;
             return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            MessageDetailPanel.viewType,
            'Loading...',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        const instance = new MessageDetailPanel(panel, explorerProvider, accountManager, accountId, folderPath, uid);
        MessageDetailPanel.panels.set(key, instance);
        MessageDetailPanel.splitPanel = instance;
        return instance;
    }

    /**
     * Restores a detail panel (for example after a VS Code restart).
     */
    static restore(
        panel: vscode.WebviewPanel,
        accountId: string,
        folderPath: string,
        uid: number,
        explorerProvider: MailExplorerProvider,
        accountManager: AccountManager
    ): MessageDetailPanel {
        const key = `${accountId}:${folderPath}:${uid}`;
        const instance = new MessageDetailPanel(panel, explorerProvider, accountManager, accountId, folderPath, uid);
        MessageDetailPanel.panels.set(key, instance);
        if (panel.viewColumn === vscode.ViewColumn.Beside || panel.viewColumn !== vscode.ViewColumn.One) {
            MessageDetailPanel.splitPanel = instance;
        }
        return instance;
    }

    /**
     * Handles external message move/delete by loading the next message or closing the panel.
     */
    public static handleExternalMove(accountId: string, folderPath: string, uid: number): void {
        const nextUid = MessageListPanel.getNextMessageUid(accountId, folderPath, uid);
        const key = `${accountId}:${folderPath}:${uid}`;
        const instance = MessageDetailPanel.panels.get(key);
        
        if (instance) {
            if (nextUid !== undefined) {
                MessageDetailPanel.panels.delete(key);
                instance.uid = nextUid;
                const newKey = `${accountId}:${folderPath}:${nextUid}`;
                MessageDetailPanel.panels.set(newKey, instance);
                instance.loadMessage();
            } else {
                instance.panel.dispose();
            }
        }
    }

    /**
     * Creates an embedded message detail panel reusing an existing WebviewPanel.
     */
    static createEmbedded(
        panel: vscode.WebviewPanel,
        explorerProvider: MailExplorerProvider,
        accountManager: AccountManager,
        accountId: string,
        folderPath: string,
        uid: number,
        onBack: () => void,
    ): MessageDetailPanel {
        return new MessageDetailPanel(panel, explorerProvider, accountManager, accountId, folderPath, uid, true, onBack);
    }

    private async loadMessage(): Promise<void> {
        try {
            this.panel.webview.html = this.getHtmlContent();
            this.panel.webview.postMessage({ type: 'loading' });

            const service = this.explorerProvider.getImapService(this.accountId);
            const message = await service.getMessage(this.folderPath, this.uid);

            this.panel.title = message.subject || '(no subject)';

            const config = vscode.workspace.getConfiguration('mailClient');
            const whitelist: string[] = config.get('imageWhitelist') || [];
            const isWhitelisted = whitelist.includes(message.from.address);
            const folderSettings = this.getFolderSettings();
            const isSpam = this.folderPath === (folderSettings.spam || 'Spam');

            // Find JIRA pairing
            let pairedJiraIssue: string | undefined;
            let pairedJiraIssueSummary: string | undefined;
            const context = this.accountManager.getContext();
            const pairings = context.globalState.get<Record<string, any>>('mailClient.jiraPairs', {});
            
            let pairData = null;
            if (message.subject) {
                const cleanSubject = message.subject.replace(/^((Re|Fw|Fwd):\s*)+/i, '').replace(/[+\-&|!(){}[\]^~*?:\/"\\]/g, ' ').replace(/\s+/g, ' ').trim();
                pairData = pairings[cleanSubject];
            }
            
            // Fallback for older pairings
            if (!pairData && message.messageId) {
                pairData = pairings[message.messageId];
            }

            if (typeof pairData === 'string') {
                pairedJiraIssue = pairData;
            } else if (pairData) {
                pairedJiraIssue = pairData.key;
                pairedJiraIssueSummary = pairData.summary;
            }

            this.panel.webview.postMessage({
                type: 'message',
                message: {
                    ...message,
                    date: message.date.toISOString(),
                    fromDisplay: message.from.name
                        ? `${message.from.name} <${message.from.address}>`
                        : message.from.address,
                    toDisplay: message.to.map(t =>
                        t.name ? `${t.name} <${t.address}>` : t.address
                    ).join(', '),
                    ccDisplay: message.cc?.map(c =>
                        c.name ? `${c.name} <${c.address}>` : c.address
                    ).join(', '),
                    folderSettings: folderSettings,
                    currentResidesIn: this.folderPath,
                    isWhitelisted: isWhitelisted,
                    isSpam: isSpam,
                    pairedJiraIssue: pairedJiraIssue,
                    pairedJiraIssueSummary: pairedJiraIssueSummary
                },
            });

            // Mark as seen if not already
            if (!message.seen) {
                await service.markMessageSeen(this.folderPath, this.uid);
                // Refresh to update unread counts
                MessageListPanel.refreshFolder(this.accountId, this.folderPath);
                this.explorerProvider.refresh();
            }

            // Sync the active message selection in the list view
            MessageListPanel.setActiveUid(this.accountId, this.folderPath, this.uid);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to load message';
            this.panel.webview.postMessage({
                type: 'error',
                message: errorMsg,
            });
        }
    }

    private handleMessage(message: any): void {
        switch (message.type) {
            case 'reply':
            case 'replyAll':
            case 'forward':
                vscode.commands.executeCommand(`mailClient.${message.type}`, {
                    accountId: this.accountId,
                    folderPath: this.folderPath,
                    uid: this.uid,
                    showImages: message.showImages,
                });
                break;
            case 'delete':
                this.deleteMessage();
                break;
            case 'archive':
            case 'spam':
            case 'trash':
            case 'newsletters':
            case 'inbox':
                this.moveMessage(message.type);
                break;
            case 'moveCustom':
                this.moveMessageCustom(message.target);
                break;
            case 'downloadAttachment':
                this.downloadAttachment(message.filename);
                break;
            case 'print':
                this.printHtml(message.html);
                break;
            case 'openExternal':
                vscode.env.openExternal(vscode.Uri.parse(message.url));
                break;
            case 'whitelistSender':
                this.whitelistSender(message.sender);
                break;
            case 'jiraSearch':
                this.searchJiraIssue(message.subject);
                break;
            case 'jiraPair':
                this.pairJiraIssue(message.subject, message.issueKey, message.summary);
                break;
            case 'jiraComment':
                this.postJiraComment(message.issueKey, message.comment);
                break;
            case 'back':
                this.dispose();
                break;
        }
    }

    private async whitelistSender(sender: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('mailClient');
        const whitelist: string[] = config.get('imageWhitelist') || [];
        if (!whitelist.includes(sender)) {
            const newWhitelist = [...whitelist, sender];
            await config.update('imageWhitelist', newWhitelist, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Sender ${sender} whitelisted.`);
            this.loadMessage(); // Reload message to show images
        }
    }

    private async pairJiraIssue(subject: string, issueKey: string, summary?: string): Promise<void> {
        if (!subject) return;
        const cleanSubject = subject.replace(/^((Re|Fw|Fwd):\s*)+/i, '').replace(/[+\-&|!(){}[\]^~*?:\/"\\]/g, ' ').replace(/\s+/g, ' ').trim();
        const context = this.accountManager.getContext();
        const pairings = context.globalState.get<Record<string, any>>('mailClient.jiraPairs', {});
        
        if (issueKey) {
            pairings[cleanSubject] = { key: issueKey, summary: summary || '' };
            vscode.window.showInformationMessage(`Message paired to JIRA issue #${issueKey}`);
        } else {
            delete pairings[cleanSubject];
        }

        await context.globalState.update('mailClient.jiraPairs', pairings);
    }

    private async postJiraComment(issueKey: string, commentBody: string): Promise<void> {
        const account = this.accountManager.getAccount(this.accountId);
        if (!account || !account.jiraUrl || !account.jiraApiKey) {
            vscode.window.showErrorMessage('Jira connection not configured.');
            this.panel.webview.postMessage({ type: 'jiraCommentResult', success: false });
            return;
        }

        try {
            const url = `${account.jiraUrl.trim().replace(/\/$/, '')}/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`;
            
            let authHeader = account.jiraApiKey.trim();
            if (!authHeader.startsWith('Basic') && !authHeader.startsWith('Bearer')) {
                if (authHeader.includes(':')) {
                    authHeader = `Basic ${Buffer.from(authHeader).toString('base64')}`;
                } else {
                    authHeader = `Basic ${Buffer.from(account.username + ':' + authHeader).toString('base64')}`;
                }
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ body: commentBody })
            });

            if (response.ok) {
                vscode.window.showInformationMessage(`Comment successfully added to ${issueKey}.`);
                this.panel.webview.postMessage({ type: 'jiraCommentResult', success: true });
            } else {
                const errorText = await response.text();
                console.error('Jira API error adding comment:', errorText);
                vscode.window.showErrorMessage('Failed to add comment to Jira.');
                this.panel.webview.postMessage({ type: 'jiraCommentResult', success: false });
            }
        } catch (e) {
            console.error('Jira Comment Error:', e);
            vscode.window.showErrorMessage('Error connecting to Jira to add comment.');
            this.panel.webview.postMessage({ type: 'jiraCommentResult', success: false });
        }
    }

    private async searchJiraIssue(subject: string): Promise<void> {
        const account = this.accountManager.getAccount(this.accountId);
        if (!account || !account.jiraUrl || !account.jiraApiKey) {
            this.panel.webview.postMessage({ type: 'jiraSearchResult', issueKey: undefined });
            return;
        }

        try {
            // Remove Re: Fwd: and characters that break JQL string literal
            const cleanSubject = subject.replace(/^((Re|Fw|Fwd):\s*)+/i, '').replace(/[+\-&|!(){}[\]^~*?:\/"\\]/g, ' ').replace(/\s+/g, ' ').trim();
            const jql = `text ~ "${cleanSubject}" ORDER BY created DESC`;
            
            const url = `${account.jiraUrl.trim().replace(/\/$/, '')}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=3&fields=key,summary,status,created`;
            
            // Allow Basic or Bearer token correctly
            let authHeader = account.jiraApiKey.trim();
            if (!authHeader.startsWith('Basic') && !authHeader.startsWith('Bearer')) {
                if (authHeader.includes(':')) {
                    authHeader = `Basic ${Buffer.from(authHeader).toString('base64')}`;
                } else {
                    // Default to Basic auth using the mail account username
                    authHeader = `Basic ${Buffer.from(account.username + ':' + authHeader).toString('base64')}`;
                }
            }

            const response = await fetch(url, {
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json() as any;                
                if (data.issues && data.issues.length > 0) {
                    const issues = data.issues.map((issue: any) => ({
                        key: issue.key,
                        summary: issue.fields?.summary,
                        statusName: issue.fields?.status?.name,
                        created: issue.fields?.created
                    }));
                    this.panel.webview.postMessage({ 
                        type: 'jiraSearchResult', 
                        issues: issues
                    });
                    return;
                }
            } else {
                console.error('Jira API error:', await response.text());
            }
        } catch (e) {
            console.error('Jira Search Error:', e);
        }

        this.panel.webview.postMessage({ type: 'jiraSearchResult', issueKey: undefined });
    }

    private async printHtml(html: string): Promise<void> {
        try {
            const tmpFile = path.join(os.tmpdir(), `mail-print-${Date.now()}.html`);
            
            let printHtml = html;
            if (!printHtml.includes('window.print()')) {
                const autoPrintScript = '<script>window.onload = () => { setTimeout(() => window.print(), 500); }</script>';
                if (printHtml.includes('</body>')) {
                    printHtml = printHtml.replace('</body>', autoPrintScript + '</body>');
                } else {
                    printHtml += autoPrintScript;
                }
            }
            
            const uri = vscode.Uri.file(tmpFile);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(printHtml, 'utf8'));
            
            await vscode.env.openExternal(uri);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Print open failed';
            vscode.window.showErrorMessage(`Print failed: ${errorMsg}`);
        }
    }

    private getFolderSettings(): any {
        const account = this.accountManager.getAccount(this.accountId);
        if (!account) return {};
        
        return {
            inbox: 'INBOX',
            trash: account.trashFolder || 'Trash',
            spam: account.spamFolder || 'Spam',
            archive: account.archiveFolder || 'Archive',
            newsletters: account.newslettersFolder || 'Newsletters',
            sent: account.sentFolder || 'Sent',
            drafts: account.draftsFolder || 'Drafts'
        };
    }

    private async moveMessage(action: 'archive' | 'spam' | 'trash' | 'newsletters' | 'inbox'): Promise<void> {
        const settings = this.getFolderSettings();
        const targetFolder = settings[action];
        
        if (!targetFolder) {
            vscode.window.showWarningMessage(`No folder for ${action}. Check settings.`);
            return;
        }

        if (this.folderPath === targetFolder) {
             vscode.window.showInformationMessage(`Already in ${action} folder.`);
             return;
        }

        try {
            const nextUid = MessageListPanel.getNextMessageUid(this.accountId, this.folderPath, this.uid);
            this.panel.webview.postMessage({ type: 'loading', text: 'Moving...' });

            const service = this.explorerProvider.getImapService(this.accountId);
            await service.moveMessage(this.folderPath, this.uid, targetFolder);
            
            vscode.window.showInformationMessage(`Moved to ${targetFolder}`);
            
            // Refresh logic similar to delete
            MessageListPanel.refreshFolder(this.accountId, this.folderPath);
            this.explorerProvider.refresh();
            
            if (nextUid !== undefined) {
                const oldKey = `${this.accountId}:${this.folderPath}:${this.uid}`;
                MessageDetailPanel.panels.delete(oldKey);
                
                this.uid = nextUid;
                
                const newKey = `${this.accountId}:${this.folderPath}:${this.uid}`;
                MessageDetailPanel.panels.set(newKey, this);

                if (MessageDetailPanel.splitPanel === this) {
                    // splitPanel is already referencing 'this', so no need to update it
                }
                
                this.loadMessage();
            } else {
                this.panel.webview.postMessage({ type: 'messageMoved', target: targetFolder });
            }
        } catch (error) {
             const errorMsg = error instanceof Error ? error.message : 'Move failed';
            vscode.window.showErrorMessage(`Failed to move message: ${errorMsg}`);
        }
    }

    private async moveMessageCustom(targetPath: string): Promise<void> {
        try {
            const nextUid = MessageListPanel.getNextMessageUid(this.accountId, this.folderPath, this.uid);
            this.panel.webview.postMessage({ type: 'loading', text: 'Moving...' });

            const service = this.explorerProvider.getImapService(this.accountId);
            await service.moveMessage(this.folderPath, this.uid, targetPath);
            
            vscode.window.showInformationMessage(`Moved to ${targetPath}`);
            
            MessageListPanel.refreshFolder(this.accountId, this.folderPath);
            this.explorerProvider.refresh();
            
            if (nextUid !== undefined) {
                const oldKey = `${this.accountId}:${this.folderPath}:${this.uid}`;
                MessageDetailPanel.panels.delete(oldKey);
                
                this.uid = nextUid;
                
                const newKey = `${this.accountId}:${this.folderPath}:${this.uid}`;
                MessageDetailPanel.panels.set(newKey, this);

                if (MessageDetailPanel.splitPanel === this) {
                    // splitPanel is already referencing 'this', so no need to update it
                }
                
                this.loadMessage();
            } else {
                this.panel.webview.postMessage({ type: 'messageMoved', target: targetPath });
            }
        } catch (error) {
             const errorMsg = error instanceof Error ? error.message : 'Move failed';
            vscode.window.showErrorMessage(`Failed to move message: ${errorMsg}`);
        }
    }

    private async deleteMessage(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Are you sure you want to PERMANENTLY delete this message?',
            { modal: true },
            'Delete Forever',
        );
        if (confirm !== 'Delete Forever') {
            return;
        }

        try {
            const nextUid = MessageListPanel.getNextMessageUid(this.accountId, this.folderPath, this.uid);
            this.panel.webview.postMessage({ type: 'loading', text: 'Deleting...' });

            const service = this.explorerProvider.getImapService(this.accountId);
            await service.deleteMessage(this.folderPath, this.uid);

            // Refresh the message list panel for this folder
            MessageListPanel.refreshFolder(this.accountId, this.folderPath);

            // Refresh folder tree (updates unread counts / badge)
            this.explorerProvider.refresh();

            if (nextUid !== undefined) {
                const oldKey = `${this.accountId}:${this.folderPath}:${this.uid}`;
                MessageDetailPanel.panels.delete(oldKey);
                
                this.uid = nextUid;
                
                const newKey = `${this.accountId}:${this.folderPath}:${this.uid}`;
                MessageDetailPanel.panels.set(newKey, this);
                
                this.loadMessage();
            } else {
                this.panel.webview.postMessage({ type: 'messageDeleted' });
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to delete message';
            vscode.window.showErrorMessage(`Delete failed: ${errorMsg}`);
        }
    }

    async downloadAttachment(filename: string): Promise<void> {
        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(filename),
                saveLabel: 'Download'
            });

            if (!uri) {
                return;
            }

            vscode.window.showInformationMessage(`Downloading ${filename}`);

            const service = this.explorerProvider.getImapService(this.accountId);
            const buffer = await service.getAttachment(this.folderPath, this.uid, filename);

            if (!buffer) {
                throw new Error('Attachment not found');
            }

            await vscode.workspace.fs.writeFile(uri, buffer);
            vscode.window.showInformationMessage(`Saved ${filename}`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Download failed';
            vscode.window.showErrorMessage(`Failed to download attachment: ${errorMsg}`);
        }
    }

    private getHtmlContent(): string {
        const nonce = getNonce();
        const config = vscode.workspace.getConfiguration('mailClient');
        const configLocale = config.get<string>('locale');
        const locale = configLocale || vscode.env.language;

        const account = this.accountManager.getAccount(this.accountId);
        const customFolders = account?.customFolders || [];
        const customButtonsHtml = customFolders.map((cf, i) => 
            `<button class="action-btn" id="btnCustom_${i}" title="Move to ${cf.name}"><span class="btn-icon">📂</span> ${cf.name}</button>`
        ).join('');

        const sharedStyles = getSharedStyles(nonce);
        const sharedScripts = getSharedScripts(nonce, locale);

        const statePayload = JSON.stringify({
            accountId: this.accountId,
            folderPath: this.folderPath,
            uid: this.uid
        });

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src * data:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Message</title>
    <style nonce="${nonce}">
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        #messageHeaders {
            flex-shrink: 0;
        }

        #messageBody {
            flex: 1;
            overflow: auto;
        }

        ${sharedStyles}

        /* Action toolbar */
        .action-bar {
            display: flex;
            flex-wrap: wrap;       /* Allow wrapping */
            flex-shrink: 0;
            padding: 0;
            border-bottom: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editorWidget-background);
            min-height: 36px;      /* Changed from height to min-height */
        }
        .action-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 0 16px;
            border: none;
            border-bottom: 1px solid var(--vscode-widget-border); /* Add a border for wrapped rows */
            border-right: 1px solid var(--vscode-widget-border);
            border-radius: 0;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-family: inherit;
            font-size: 0.9em;
            height: 36px; /* Fixed height for each row/button */
        }
        .action-btn svg {
            width: 24px;
            height: 24px;
            fill: currentColor;
        }
        .btn-icon {
            font-size: 1.6em;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
        }
        .action-btn.icon-only {
            padding: 0;
            width: 42px;
            justify-content: center;
            border-left: 1px solid var(--vscode-widget-border);
            border-right: none;
        }
        .action-bar > .action-btn:last-child {
            border-right: none;
        }
        .action-btn:hover {
            background: #ff9800 !important;
            color: #ffffff !important;
        }
        .action-btn.icon-only:hover {
            transform: none;
        }
        .action-btn.danger {
            color: var(--vscode-errorForeground);
        }
        .action-btn.danger:hover {
            background: #e53935 !important;
            color: #ffffff !important;
        }

        .loading, .error-msg {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .error-msg { color: var(--vscode-errorForeground); }
         .hidden { display: none !important; }

        /* Print Overlay */
        #printOverlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: var(--vscode-editor-background);
            z-index: 9999;
            display: flex;
            flex-direction: column;
        }
        .print-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 16px;
            background: var(--vscode-editorWidget-background);
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .print-toolbar button {
            padding: 6px 16px;
            font-size: 14px;
            cursor: pointer;
            border: 1px solid var(--vscode-button-border, transparent);
            border-radius: 2px;
            font-family: inherit;
        }
        #btnClosePrint {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        #btnClosePrint:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        #btnConfirmPrint {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #btnConfirmPrint svg {
            width: 16px;
            height: 16px;
            fill: none;
            stroke: currentColor;
        }
        #btnConfirmPrint:hover {
            background: var(--vscode-button-hoverBackground);
        }
        #printIframe {
            flex: 1;
            width: 100%;
            height: 100%;
            border: none;
            background: white;
        }

        /* Jira Modal */
        #jiraModalOverlay {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.5); z-index: 10000;
            display: flex; justify-content: center; align-items: center;
        }
        .jira-modal {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 20px;
            width: 400px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 12px;
        }
        .jira-modal h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--vscode-foreground); }
        .jira-modal-body { display: flex; gap: 8px; align-items: center; }
        .jira-modal input {
            flex: 1; padding: 6px; font-size: 14px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
        }
        .jira-modal button {
            padding: 6px 12px; border: none; border-radius: 2px;
            cursor: pointer; font-family: inherit; font-size: 13px;
        }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        #jiraStatus { font-size: 12px; color: var(--vscode-descriptionForeground); min-height: 18px; margin-top: -4px; }
    </style>
</head>
<body>
    <div id="messageHeaders"></div>

    <div class="action-bar ${this.isEmbedded ? '' : 'hidden'}" id="actionBar">
        ${this.isEmbedded ? '<button class="action-btn" id="btnBack" title="Back to List"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back</button>' : ''}
        <div id="messageButtons" class="hidden" style="display: flex; flex-wrap: wrap; flex: 1;">
            <div style="display: flex; flex-wrap: wrap;">
                <button class="action-btn" id="btnInbox" title="Move to Inbox"><span class="btn-icon">📥</span> Inbox</button>
                <button class="action-btn" id="btnArchive" title="Archive"><span class="btn-icon">📂</span> Archive</button>
                <button class="action-btn" id="btnSpam" title="Mark as Spam"><span class="btn-icon">⛔</span> Spam</button>
                <button class="action-btn" id="btnNewsletters" title="Move to Newsletters"><span class="btn-icon">📰</span> News</button>
                <button class="action-btn" id="btnTrash" title="Move to Trash"><span class="btn-icon">🗑</span> Trash</button>
                <button class="action-btn danger hidden" id="btnDelete" title="Delete Permanently"><span class="btn-icon">❌</span> Delete</button>
                ${customButtonsHtml}
            </div>
            <div style="display: flex; margin-left: auto; align-items: center;">
            <button class="action-btn" id="btnJiraPair" title="JIRA issue" style="border-left: 1px solid var(--vscode-widget-border);"><span class="btn-icon">🔗</span> <span id="btnJiraPairText">JIRA issue</span></button>
            <button class="action-btn icon-only" id="btnPrint" title="Print"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg></button>
            <button class="action-btn icon-only" id="btnForward" title="Forward"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6L15 12L9 18"></path></svg></button>
            <button class="action-btn icon-only" id="btnReply" title="Reply"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6L9 12L15 18"></path></svg></button>
            <button class="action-btn icon-only" id="btnReplyAll" title="Reply All"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6L11 12L17 18"></path><path d="M10 6L4 12L10 18"></path></svg></button>
            </div>
        </div>
    </div>

    <div id="messageBody"></div>

    <div id="loadingIndicator" class="loading"><span class="loader"></span>Loading message...</div>

    <div id="printOverlay" class="hidden">
        <div class="print-toolbar">
            <span style="color: var(--vscode-descriptionForeground); font-size: 13px; margin-right: auto; padding-left: 8px;">
                The preview will open in your default web browser for printing.
            </span>
            <button id="btnClosePrint" style="margin-right: 8px;">Close</button>
            <button id="btnConfirmPrint"><svg viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> PRINT</button>
        </div>
        <iframe id="printIframe" sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals"></iframe>
    </div>

    <div id="jiraModalOverlay" class="hidden">
        <div class="jira-modal">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h3>Pair to JIRA issue</h3>
                <button class="action-btn icon-only" id="btnJiraCloseModal" title="Close" style="padding: 4px; border:none; background:transparent; cursor:pointer; color:var(--vscode-foreground);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <span style="font-size: 13px;">Enter Issue Key to Pair:</span>
                <div class="jira-modal-body">
                    <input type="text" id="jiraIssueInput" placeholder="e.g. PROJ-123">
                    <button class="btn-primary" id="btnJiraSave">Pair</button>
                    <button class="btn-secondary hidden" id="btnJiraCommentStart">Comment</button>
                </div>
            </div>

            <!-- Comment section -->
            <div id="jiraCommentSection" class="hidden" style="border-top: 1px solid var(--vscode-widget-border); padding-top: 12px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
                <span style="font-size: 13px;">Add Comment to Issue:</span>
                <div id="jiraCommentEditor" contenteditable="true" style="min-height: 120px; max-height: 250px; overflow-y: auto; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 2px; font-size: 13px; outline: none;"></div>
                <div style="display: flex; justify-content: flex-end; gap: 8px; align-items: center;">
                    <div id="jiraCommentStatus" style="font-size: 12px; margin-right: auto; padding-left: 4px;"></div>
                    <button class="btn-secondary" id="btnJiraCommentCancel">Cancel</button>
                    <button class="btn-primary" id="btnJiraCommentSend">Send</button>
                </div>
            </div>

            <div id="jiraSearchSection" style="border-top: 1px solid var(--vscode-widget-border); padding-top: 12px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
                <span style="font-size: 13px;">Search for Issue by subject:</span>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="jiraSearchQueryInput" placeholder="Search query...">
                    <button class="btn-secondary" id="btnJiraSearchCustom">Search</button>
                </div>
            </div>

            <div id="jiraStatus" style="margin-top: 4px; margin-bottom: 8px;"></div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        vscode.setState(${statePayload});
        
        ${sharedScripts}
        
        const customFolders = ${JSON.stringify(customFolders)};
        console.log('Using locale:', userLocale);
        const headersEl = document.getElementById('messageHeaders');
        const bodyEl = document.getElementById('messageBody');
        const actionBar = document.getElementById('actionBar');
        const loadingEl = document.getElementById('loadingIndicator');
        let currentMessage = null;
        let currentShowImages = false;
        let lastJiraSearchResultSummary = '';

        document.getElementById('btnPrint').addEventListener('click', showPrintPreview);
        document.getElementById('btnClosePrint').addEventListener('click', () => {
            document.getElementById('printOverlay').classList.add('hidden');
        });
        document.getElementById('btnConfirmPrint').addEventListener('click', () => {
            const iframe = document.getElementById('printIframe');
            if (iframe && iframe.srcdoc) {
                vscode.postMessage({ type: 'print', html: iframe.srcdoc });
            }
        });

        function showPrintPreview() {
            if (!currentMessage) return;
            const overlay = document.getElementById('printOverlay');
            overlay.classList.remove('hidden');
            
            const iframe = document.getElementById('printIframe');
            
            let headersHtml = '<div style="font-family: sans-serif; padding: 16px 0 0 0; color: #000; font-size: 14px;">';
            headersHtml += '<div style="margin-bottom: 4px;"><strong>From:</strong> ' + escapeHtml(currentMessage.fromDisplay) + '</div>';
            headersHtml += '<div style="margin-bottom: 4px;"><strong>Date:</strong> ' + formatDate(currentMessage.date) + '</div>';
            headersHtml += '<div style="margin-bottom: 4px;"><strong>To:</strong> ' + escapeHtml(currentMessage.toDisplay) + '</div>';
            if (currentMessage.ccDisplay) {
                headersHtml += '<div style="margin-bottom: 4px;"><strong>Cc:</strong> ' + escapeHtml(currentMessage.ccDisplay) + '</div>';
            }
            headersHtml += '<div style="margin-bottom: 4px;"><strong>Subject:</strong> ' + escapeHtml(currentMessage.subject || '(no subject)') + '</div>';
            headersHtml += '<hr style="margin: 20px 0; border: 0; border-top: 1px solid #ccc;">';
            headersHtml += '</div>';

            const result = renderMessageContent(currentMessage, currentShowImages);
            let rawBodyHtml = result.html;
            
            if (rawBodyHtml.match(/<body[^>]*>/i)) {
                rawBodyHtml = rawBodyHtml.replace(/(<body[^>]*>)/i, '$1' + headersHtml);
            } else {
                rawBodyHtml = headersHtml + rawBodyHtml;
            }
            
            const printStyle = '<style>@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }</style>';
            if (rawBodyHtml.includes('</head>')) {
                rawBodyHtml = rawBodyHtml.replace('</head>', printStyle + '</head>');
            } else {
                rawBodyHtml = printStyle + rawBodyHtml;
            }
            
            iframe.srcdoc = rawBodyHtml;
        }

        document.getElementById('btnReply').addEventListener('click', () => {
            vscode.postMessage({ type: 'reply', showImages: currentShowImages });
        });
        document.getElementById('btnReplyAll').addEventListener('click', () => {
            vscode.postMessage({ type: 'replyAll', showImages: currentShowImages });
        });
        document.getElementById('btnForward').addEventListener('click', () => {
            vscode.postMessage({ type: 'forward', showImages: currentShowImages });
        });
        document.getElementById('btnInbox').addEventListener('click', () => vscode.postMessage({ type: 'inbox' }));
        document.getElementById('btnArchive').addEventListener('click', () => vscode.postMessage({ type: 'archive' }));
        document.getElementById('btnSpam').addEventListener('click', () => vscode.postMessage({ type: 'spam' }));
        document.getElementById('btnNewsletters').addEventListener('click', () => vscode.postMessage({ type: 'newsletters' }));
        document.getElementById('btnTrash').addEventListener('click', () => vscode.postMessage({ type: 'trash' }));
        document.getElementById('btnDelete').addEventListener('click', () => vscode.postMessage({ type: 'delete' }));

        customFolders.forEach((cf, i) => {
            const btn = document.getElementById('btnCustom_' + i);
            if (btn) {
                btn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'moveCustom', target: cf.path });
                });
            }
        });

        // Jira Modal Logic
        const jiraModal = document.getElementById('jiraModalOverlay');
        const jiraInput = document.getElementById('jiraIssueInput');
        const jiraStatus = document.getElementById('jiraStatus');
        const btnJiraPairText = document.getElementById('btnJiraPairText');
        const jiraSearchFallback = document.getElementById('jiraSearchFallback');
        const jiraSearchQueryInput = document.getElementById('jiraSearchQueryInput');

        const btnJiraCommentStart = document.getElementById('btnJiraCommentStart');
        const jiraCommentSection = document.getElementById('jiraCommentSection');
        const jiraSearchSection = document.getElementById('jiraSearchSection');
        const jiraCommentEditor = document.getElementById('jiraCommentEditor');
        const jiraCommentStatus = document.getElementById('jiraCommentStatus');

        const updateCommentButtonVisibility = () => {
             const val = jiraInput.value.trim();
             if (val) {
                 btnJiraCommentStart.classList.remove('hidden');
             } else {
                 btnJiraCommentStart.classList.add('hidden');
             }
        };

        jiraInput.addEventListener('input', updateCommentButtonVisibility);

        document.getElementById('btnJiraPair').addEventListener('click', () => {
            jiraModal.classList.remove('hidden');
            jiraCommentSection.classList.add('hidden');
            jiraSearchSection.classList.remove('hidden');
            jiraInput.value = (currentMessage && currentMessage.pairedJiraIssue) ? currentMessage.pairedJiraIssue : '';
            jiraStatus.innerHTML = '';
            lastJiraSearchResultSummary = '';
            
            updateCommentButtonVisibility();

            if (currentMessage && currentMessage.pairedJiraIssueSummary) {
                jiraSearchQueryInput.value = currentMessage.pairedJiraIssueSummary;
            } else if (currentMessage && currentMessage.subject) {
                const cleanSubject = currentMessage.subject.replace(/^((Re|Fw|Fwd):\\s*)+/i, '').replace(/[+\\-&|!(){}[\\]^~*?:\\/"\\\\]/g, ' ').replace(/\\s+/g, ' ').trim();
                jiraSearchQueryInput.value = cleanSubject;
            } else {
                jiraSearchQueryInput.value = '';
            }
            jiraInput.focus();
        });

        document.getElementById('btnJiraCloseModal').addEventListener('click', () => {
            jiraModal.classList.add('hidden');
        });

        // Comment functionality
        document.getElementById('btnJiraCommentStart').addEventListener('click', () => {
            jiraSearchSection.classList.add('hidden');
            jiraCommentSection.classList.remove('hidden');
            jiraCommentStatus.innerHTML = '';
            if (currentMessage) {
                let commentHtml = '<strong>From:</strong> ' + escapeHtml(currentMessage.fromDisplay) + '<br>';
                commentHtml += '<strong>To:</strong> ' + escapeHtml(currentMessage.toDisplay) + '<br>';
                if (currentMessage.ccDisplay) {
                    commentHtml += '<strong>Cc:</strong> ' + escapeHtml(currentMessage.ccDisplay) + '<br>';
                }
                commentHtml += '<strong>Subject:</strong> ' + escapeHtml(currentMessage.subject || '(no subject)') + '<br>';
                commentHtml += '<strong>Date:</strong> ' + formatDate(currentMessage.date) + '<br>';
                commentHtml += '<br>';
                let bodyContent = '';
                if (currentMessage.text) {
                    let lines = currentMessage.text.split(/\\r?\\n/);
                    let outLines = [];
                    for(let i = 0; i < lines.length; i++) {
                        let l = lines[i].trim();
                        // Strip common English and Czech reply headers
                        if (
                            l.match(/^(On|Dne)\\s.*(wrote|napsal\\(a\\)|napsal):$/i) ||
                            l.match(/^(---|____)*\\s*(message|zpráva|zprava)\\s*(---|____)*$/i) ||
                            l.match(/^_{10,}$/) ||
                            (l.match(/^(From|Od):\\s/i) && i > 0 && lines[i-1].trim() === '')
                        ) {
                            break;
                        }
                        outLines.push(lines[i]);
                    }
                    bodyContent = escapeHtml(outLines.join('\\n').trim()).replace(/\\n/g, '<br>');
                } else if (currentMessage.html) {
                    // Fallback to stripping the first blockquote if only HTML is available
                    bodyContent = currentMessage.html.split(/<blockquote/i)[0];
                }
                commentHtml += bodyContent;
                jiraCommentEditor.innerHTML = commentHtml;
            }
        });

        document.getElementById('btnJiraCommentCancel').addEventListener('click', () => {
            jiraCommentSection.classList.add('hidden');
            jiraSearchSection.classList.remove('hidden');
        });

        document.getElementById('btnJiraCommentSend').addEventListener('click', () => {
            const commentText = jiraCommentEditor.innerText.trim();
            const issueKey = jiraInput.value.trim();
            if (!commentText || !issueKey) return;
            jiraCommentStatus.innerHTML = '<span class="loader" style="width:12px; height:12px; border-width: 2px;"></span> Sending...';
            vscode.postMessage({ type: 'jiraComment', issueKey: issueKey, comment: commentText });
        });

        // Search trigger functionality
        const doSearch = () => {
            const query = jiraSearchQueryInput.value.trim();
            if (!query) return;
            jiraStatus.innerHTML = '<span class="loader" style="width:12px; height:12px; border-width: 2px;"></span> Searching...';
            vscode.postMessage({ type: 'jiraSearch', subject: query });
        };
        document.getElementById('btnJiraSearchCustom').addEventListener('click', doSearch);
        jiraSearchQueryInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') doSearch();
        });

        // Save trigger functionality
        const doSave = () => {
            const val = jiraInput.value.trim();
            if (currentMessage) {
                 if (val) {
                     const summaryToSave = lastJiraSearchResultSummary || jiraSearchQueryInput.value.trim();
                     vscode.postMessage({ type: 'jiraPair', subject: currentMessage.subject, issueKey: val, summary: summaryToSave });
                     btnJiraPairText.innerText = 'JIRA #' + val;
                     currentMessage.pairedJiraIssue = val;
                     currentMessage.pairedJiraIssueSummary = summaryToSave;
                 } else {
                     // Clear the pairing
                     vscode.postMessage({ type: 'jiraPair', subject: currentMessage.subject, issueKey: '', summary: '' });
                     btnJiraPairText.innerText = 'JIRA';
                     currentMessage.pairedJiraIssue = '';
                     currentMessage.pairedJiraIssueSummary = '';
                 }
                 updateCommentButtonVisibility();
            }
            jiraModal.classList.add('hidden');
        };
        document.getElementById('btnJiraSave').addEventListener('click', doSave);
        jiraInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') doSave();
        });

        // Show/Hide buttons based on current folder
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.type === 'message') {
                renderMessageView(msg.message);

                const settings = msg.message.folderSettings || {};
                const current = msg.message.currentResidesIn;
                
                const btnInbox = document.getElementById('btnInbox');
                const btnArchive = document.getElementById('btnArchive');
                const btnSpam = document.getElementById('btnSpam');
                const btnNewsletters = document.getElementById('btnNewsletters');
                const btnTrash = document.getElementById('btnTrash');
                const btnDelete = document.getElementById('btnDelete');
                
                if (btnInbox) {
                    if (current.toUpperCase() === 'INBOX' || current === settings.inbox) {
                        btnInbox.classList.add('hidden');
                    } else {
                        btnInbox.classList.remove('hidden');
                    }
                }
                
                if (btnArchive) {
                    if (current === settings.archive) {
                        btnArchive.classList.add('hidden');
                    } else {
                        btnArchive.classList.remove('hidden');
                    }
                }

                if (btnSpam) {
                    if (current === settings.spam) {
                        btnSpam.classList.add('hidden');
                    } else {
                        btnSpam.classList.remove('hidden');
                    }
                }

                if (btnNewsletters) {
                    if (current === settings.newsletters) {
                        btnNewsletters.classList.add('hidden');
                    } else {
                        btnNewsletters.classList.remove('hidden');
                    }
                }
                
                if (btnTrash && btnDelete) {
                    if (current === settings.trash) {
                        btnTrash.classList.add('hidden');
                        btnDelete.classList.remove('hidden');
                    } else {
                        btnTrash.classList.remove('hidden');
                        btnDelete.classList.add('hidden');
                    }
                }

                if (msg.message.pairedJiraIssue) {
                    btnJiraPairText.innerText = 'JIRA #' + msg.message.pairedJiraIssue;
                } else {
                    btnJiraPairText.innerText = 'JIRA';
                }

                customFolders.forEach((cf, i) => {
                    const btn = document.getElementById('btnCustom_' + i);
                    if (btn) {
                        if (current === cf.path) {
                            btn.classList.add('hidden');
                        } else {
                            btn.classList.remove('hidden');
                        }
                    }
                });
            }
        });

        const btnBack = document.getElementById('btnBack');
        if (btnBack) {
            btnBack.addEventListener('click', () => {
                vscode.postMessage({ type: 'back' });
            });
        }

        function renderMessageView(msg, showImages = false) {
             currentMessage = msg;
             currentShowImages = showImages;
             loadingEl.classList.add('hidden');
             
             // Render everything into bodyEl (which is in the DOM, so getElementById works)
             // Create warning element dynamically if not present, and place above bodyEl
             let warningEl = document.getElementById('messageWarning');
             if (!warningEl) {
                 warningEl = document.createElement('div');
                 warningEl.id = 'messageWarning';
                 bodyEl.parentNode.insertBefore(warningEl, bodyEl);
             }
             renderMessage(bodyEl, msg, showImages, '_main', false, true, warningEl);
             
             // Extract headers + attachments from bodyEl and move to headersEl
             headersEl.innerHTML = '';
             const headers = bodyEl.querySelector('.message-headers');
             const attachments = bodyEl.querySelector('.attachments');
             if (headers) headersEl.appendChild(headers);
             if (attachments) headersEl.appendChild(attachments);
             
             // Show action bar
             actionBar.classList.remove('hidden');
             const msgBtns = document.getElementById('messageButtons');
             if (msgBtns) {
                 msgBtns.classList.remove('hidden');
             }
             
            // Re-bind listener for show images
              bodyEl.addEventListener('requestShowImages', (e) => {
                const message = e.detail.message;
                renderMessageView(message, true);
              });

              bodyEl.addEventListener('requestWhitelistSender', (e) => {
                const message = e.detail.message;
                vscode.postMessage({ type: 'whitelistSender', sender: message.from.address });
              });

            // Attachment buttons
            document.querySelectorAll('.attachment-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                   const filename = decodeURIComponent(btn.dataset.filename);
                   downloadAttachment(filename);
                });
            });
        }


        const isEmbedded = ${this.isEmbedded};

        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'jiraSearchResult':
                    if (msg.issues && msg.issues.length > 0) {
                        let infoHtml = '<div style="display:flex; flex-direction:column; gap:6px;">';
                        msg.issues.forEach((issue, index) => {
                            let itemHtml = '<div><strong>Found Issue:</strong> <a href="#" class="jira-issue-link" data-key="' + escapeHtml(issue.key) + '" data-summary="' + escapeHtml(issue.summary || '') + '" style="color:var(--vscode-textLink-foreground); text-decoration:none;">' + escapeHtml(issue.key) + '</a>';
                            if (issue.summary) itemHtml += ' - ' + escapeHtml(issue.summary);
                            if (issue.statusName) itemHtml += '<br><strong>Status:</strong> ' + escapeHtml(issue.statusName);
                            if (issue.created) {
                                const d = new Date(issue.created);
                                itemHtml += ' | <strong>Created:</strong> ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
                            }
                            itemHtml += '</div>';
                            infoHtml += itemHtml;
                        });
                        infoHtml += '</div>';
                        jiraStatus.innerHTML = infoHtml;
                        
                        // Add click listeners to the dynamically created links
                        const links = jiraStatus.querySelectorAll('.jira-issue-link');
                        links.forEach(link => {
                            link.addEventListener('click', (e) => {
                                e.preventDefault();
                                jiraInput.value = link.getAttribute('data-key');
                                lastJiraSearchResultSummary = link.getAttribute('data-summary');
                                // highlight briefly or provide feedback? Just focusing is fine for now
                                jiraInput.focus();
                            });
                        });
                    } else {
                        jiraStatus.innerText = 'Not found';
                    }
                    break;
                case 'jiraCommentResult':
                    if (msg.success) {
                        jiraCommentSection.classList.add('hidden');
                        jiraSearchSection.classList.remove('hidden');
                        jiraCommentStatus.innerHTML = '';
                    } else {
                        jiraCommentStatus.innerHTML = '<span style="color:var(--vscode-errorForeground);">Failed to send comment.</span>';
                    }
                    break;
                case 'loading':
                    headersEl.innerHTML = '';
                    bodyEl.innerHTML = '';
                    if (!isEmbedded) {
                        actionBar.classList.add('hidden');
                    }
                    const mb = document.getElementById('messageButtons');
                    if (mb) mb.classList.add('hidden');
                    
                    loadingEl.classList.remove('hidden');
                    const loadingText = msg.text || 'Loading message...';
                    loadingEl.innerHTML = '<span class="loader"></span>' + escapeHtml(loadingText);
                    break;
                case 'messageMoved':
                    headersEl.innerHTML = '';
                    bodyEl.innerHTML = '<div class="empty-msg">Moved to ' + escapeHtml(msg.target) + '.</div>';
                    if (!isEmbedded) {
                        actionBar.classList.add('hidden');
                    }
                    if (document.getElementById('messageButtons')) document.getElementById('messageButtons').classList.add('hidden');
                    loadingEl.classList.add('hidden');
                    break;
                case 'messageDeleted':
                    headersEl.innerHTML = '';
                    bodyEl.innerHTML = '<div class="empty-msg">Message deleted.</div>';
                    if (!isEmbedded) {
                        actionBar.classList.add('hidden');
                    }
                    if (document.getElementById('messageButtons')) document.getElementById('messageButtons').classList.add('hidden');
                    loadingEl.classList.add('hidden');
                    break;
                case 'message':
                    console.log('Received message data', msg);
                    try {
                        currentMessage = msg.message;
                        renderMessageView(msg.message, false);
                        console.log('Message rendered successfully');
                    } catch (e) {
                        console.error('Render error', e);
                        bodyEl.innerHTML = '<div class="error-msg">Render Error: ' + (e instanceof Error ? e.message : String(e)) + '</div>';
                    }
                    break;
                case 'error':
                    loadingEl.classList.add('hidden');
                    if (!isEmbedded) {
                        actionBar.classList.add('hidden');
                    }
                    const mbe = document.getElementById('messageButtons');
                    if (mbe) mbe.classList.add('hidden');

                    bodyEl.innerHTML = '<div class="error-msg">Error: ' + escapeHtml(msg.message) + '</div>';
                    break;
            }
        });

        function downloadAttachment(filename) {
            vscode.postMessage({ type: 'downloadAttachment', filename: filename });
        }
    </script>
</body>
</html>`;
    }

    dispose(): void {
        const key = `${this.accountId}:${this.folderPath}:${this.uid}`;
        MessageDetailPanel.panels.delete(key);
        if (MessageDetailPanel.splitPanel === this) {
            MessageDetailPanel.splitPanel = undefined;
        }
        if (!this.isEmbedded) {
            this.panel.dispose();
        } else if (this.onBack) {
            this.onBack();
        }
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

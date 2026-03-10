import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { MailExplorerProvider } from '../providers/mailExplorerProvider';
import { AccountManager } from '../services/accountManager';
import { MessageListPanel } from './messageListPanel';
import { IMailMessageDetail } from '../types/message';
import { getSharedStyles, getSharedScripts } from './utils/webviewContent';

// @ts-ignore
import messageDetailHtml from './views/messageDetail/messageDetail.html';
// @ts-ignore
import messageDetailCss from './views/messageDetail/messageDetail.css';
// @ts-ignore
import messageDetailJs from './views/messageDetail/messageDetail.js';

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

        const config = vscode.workspace.getConfiguration('mailClient');
        const isBottom = config.get<string>('detailPanelLocation') === 'bottom';

        const panel = vscode.window.createWebviewPanel(
            MessageDetailPanel.viewType,
            'Loading...',
            isBottom ? vscode.ViewColumn.Active : { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        if (isBottom) {
            // Delaying slightly to ensure the new panel is fully active in the editor grid
            setTimeout(() => {
                vscode.commands.executeCommand('workbench.action.moveEditorToBelowGroup');
            }, 100);
        }

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
            const contacts: string[] = config.get('contacts') || [];
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
                    pairedJiraIssueSummary: pairedJiraIssueSummary,
                    hasJira: !!this.accountManager.getAccount(this.accountId)?.jiraApiKey,
                    contacts: contacts
                },
            });

            // Mark as seen if not already
            if (!message.seen) {
                await service.markMessageSeen(this.folderPath, this.uid);
                // Update local cache and fire tree update without full network reload
                this.explorerProvider.decrementUnread(this.accountId, this.folderPath);
                // Refresh to update unread counts on the message list panel
                MessageListPanel.refreshFolder(this.accountId, this.folderPath);
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
            case 'addContact':
                this.addContact(message.contact);
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

    private async addContact(contact: string): Promise<void> {
        if (!contact) return;
        const config = vscode.workspace.getConfiguration('mailClient');
        const contacts: string[] = config.get('contacts') || [];
        if (!contacts.includes(contact)) {
            const newContacts = [...contacts, contact];
            await config.update('contacts', newContacts, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Added to contacts: ${contact}`);
            this.panel.webview.postMessage({
                type: 'contactAdded',
                contact: contact,
                contacts: newContacts
            });
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
            const newUid = await service.moveMessage(this.folderPath, this.uid, targetFolder);
            
            const undoLabel = `Undo`;
            const actions = newUid ? [undoLabel] : [];
            const originalFolderPath = this.folderPath;
            vscode.window.showInformationMessage(`Moved to ${targetFolder}`, ...actions).then(selection => {
                if (selection === undoLabel && newUid) {
                    service.moveMessage(targetFolder, newUid, originalFolderPath).then((restoredUid) => {
                        vscode.window.showInformationMessage(`Moved back to ${originalFolderPath}`);
                        MessageListPanel.refreshFolder(this.accountId, originalFolderPath, restoredUid, true);
                        this.explorerProvider.refresh();
                    }).catch(err => {
                        vscode.window.showErrorMessage(`Failed to undo move: ${err.message}`);
                    });
                }
            });
            
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
            const newUid = await service.moveMessage(this.folderPath, this.uid, targetPath);
            
            const undoLabel = `Undo`;
            const actions = newUid ? [undoLabel] : [];
            const originalFolderPath = this.folderPath;
            vscode.window.showInformationMessage(`Moved to ${targetPath}`, ...actions).then(selection => {
                if (selection === undoLabel && newUid) {
                    service.moveMessage(targetPath, newUid, originalFolderPath).then((restoredUid) => {
                        vscode.window.showInformationMessage(`Moved back to ${originalFolderPath}`);
                        MessageListPanel.refreshFolder(this.accountId, originalFolderPath, restoredUid, true);
                        this.explorerProvider.refresh();
                    }).catch(err => {
                        vscode.window.showErrorMessage(`Failed to undo move: ${err.message}`);
                    });
                }
            });
            
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
            `<button class="action-btn icon-only" id="btnCustom_${i}" title="Move to ${cf.name}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>`
        ).join('');

        const sharedStyles = getSharedStyles(nonce);
        const sharedScripts = getSharedScripts(nonce, locale);

        const statePayload = JSON.stringify({
            accountId: this.accountId,
            folderPath: this.folderPath,
            uid: this.uid
        });

        const isEmbeddedClass = this.isEmbedded ? '' : 'hidden';
        const backButtonHtml = this.isEmbedded ? '<button class="action-btn" id="btnBack" title="Back to List"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back</button>' : '';

        return messageDetailHtml
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace('/* {{SHARED_STYLES}} */', sharedStyles)
            .replace('/* {{CSS_INJECT}} */', messageDetailCss)
            .replace('{{IS_EMBEDDED_CLASS}}', isEmbeddedClass)
            .replace('{{BACK_BUTTON_HTML}}', backButtonHtml)
            .replace('{{CUSTOM_BUTTONS_HTML}}', customButtonsHtml)
            .replace('"{{STATE_PAYLOAD}}"', statePayload)
            .replace('// {{SHARED_SCRIPTS}}', sharedScripts)
            .replace('"{{CUSTOM_FOLDERS_JSON}}"', JSON.stringify(customFolders))
            .replace('"{{IS_EMBEDDED}}"', String(this.isEmbedded))
            .replace('// {{JS_INJECT}}', messageDetailJs);
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

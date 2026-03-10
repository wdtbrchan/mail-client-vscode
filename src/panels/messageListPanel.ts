import * as vscode from 'vscode';
import { MailExplorerProvider, MailTreeItem } from '../providers/mailExplorerProvider';
import { IMailMessage } from '../types/message';
import { MessageDetailPanel } from './messageDetailPanel';
import { AccountManager } from '../services/accountManager';

/**
 * Webview panel for displaying a list of messages in a mail folder.
 * Shows a table with date, sender, subject, attachment indicator, and action buttons.
 */
export class MessageListPanel {
    public static readonly viewType = 'mailClient.messageList';
    private static panels = new Map<string, MessageListPanel>();
    /** The single reusable panel used for tree item clicks */
    private static activePanel: MessageListPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private currentSearchQuery: string = '';
    private currentMessages: IMailMessage[] = [];
    public activeUid?: number;
    private currentPage: number = 1;
    private totalMessages: number = 0;
    private lastUnreadCount?: number;

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly explorerProvider: MailExplorerProvider,
        private readonly accountManager: AccountManager,
        private accountId: string,
        private folderPath: string,
        private folderName: string,
    ) {

        this.panel = panel;
        this.panel.webview.html = this.getHtmlContent();

        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables,
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Load messages initially
        this.loadMessages();
    }

    /**
     * Opens the folder in the single reusable (active) panel.
     * If the panel already exists, it switches to the new folder.
     */
    static showInActive(
        explorerProvider: MailExplorerProvider,
        accountManager: AccountManager,
        accountId: string,
        folderPath: string,
        folderName: string,
    ): MessageListPanel {
        if (MessageListPanel.activePanel) {
            const active = MessageListPanel.activePanel;
            // Remove old key from panels map
            const oldKey = `${active.accountId}:${active.folderPath}`;
            MessageListPanel.panels.delete(oldKey);
            active.accountId = accountId;
            active.folderPath = folderPath;
            active.folderName = folderName;
            active.currentSearchQuery = ''; // Reset search on folder switch
            active.currentPage = 1; // Reset page
            
            // Revert any embedded view to list view
            active.clearEmbeddedDetail();

            // Register under new key
            const newKey = `${accountId}:${folderPath}`;
            MessageListPanel.panels.set(newKey, active);
            active.panel.reveal();
            active.loadMessages();
            return active;
        }

        const instance = MessageListPanel.show(explorerProvider, accountManager, accountId, folderPath, folderName);
        MessageListPanel.activePanel = instance;
        return instance;
    }

    /**
     * Opens or reveals a message list panel for the given folder in a new tab.
     */
    static show(
        explorerProvider: MailExplorerProvider,
        accountManager: AccountManager,
        accountId: string,
        folderPath: string,
        folderName: string,
    ): MessageListPanel {
        const key = `${accountId}:${folderPath}`;

        // Reuse existing panel for this folder
        const existing = MessageListPanel.panels.get(key);
        if (existing) {
            existing.panel.reveal();
            existing.loadMessages();
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            MessageListPanel.viewType,
            folderName,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        const instance = new MessageListPanel(panel, explorerProvider, accountManager, accountId, folderPath, folderName);
        MessageListPanel.panels.set(key, instance);
        return instance;
    }

    /**
     * Refreshes the message list for a specific folder (if a panel is open for it).
     */
    static refreshFolder(accountId: string, folderPath: string, activeUid?: number, autoOpen?: boolean): void {
        const key = `${accountId}:${folderPath}`;
        const panel = MessageListPanel.panels.get(key);
        if (panel) {
            if (activeUid !== undefined) {
                panel.activeUid = activeUid;
            }
            if (autoOpen && activeUid !== undefined) {
                panel.openMessage(activeUid);
            }
            panel.loadMessages();
        }
    }

    private getFolderSettings(): Record<string, string> {
        const account = this.accountManager.getAccount(this.accountId);
        if (!account) return {};
        return {
            inbox: 'INBOX',
            trash: account.trashFolder || 'Trash',
            spam: account.spamFolder || 'Spam',
            archive: account.archiveFolder || 'Archive',
            newsletters: account.newslettersFolder || 'Newsletters',
            sent: account.sentFolder || 'Sent',
            drafts: account.draftsFolder || 'Drafts',
        };
    }

    private updateTitle(unseen?: number) {
        if (unseen !== undefined) {
            this.lastUnreadCount = unseen;
        }
        
        const count = this.lastUnreadCount || 0;
        this.panel.title = count > 0 ? `${this.folderName} (${count})` : this.folderName;
    }

    private async loadMessages(): Promise<void> {
        try {
            this.panel.webview.postMessage({ type: 'loading' });

            const config = vscode.workspace.getConfiguration('mailClient');
            const limit = config.get<number>('messagesPerPage', 50);
            const offset = (this.currentPage - 1) * limit;

            const service = this.explorerProvider.getImapService(this.accountId);
            const result = await service.getMessages(this.folderPath, limit, offset, this.currentSearchQuery);

            this.currentMessages = result.messages;
            this.totalMessages = result.total;

            const folderInfo = this.explorerProvider.getFolderInfo(this.accountId, this.folderPath);
            this.updateTitle(folderInfo?.unseenMessages);

            const locale = config.get<string>('locale') || undefined;
            const displayMode = config.get<string>('messageDisplayMode', 'split');

            this.panel.webview.postMessage({
                type: 'messages',
                messages: result.messages.map(m => ({
                    ...m,
                    date: m.date.toISOString(),
                    fromDisplay: m.from.name || m.from.address,
                    toDisplay: m.to.map(t => t.name || t.address).join(', '),
                    ccDisplay: m.cc ? m.cc.map(t => t.name || t.address).join(', ') : '',
                    bccDisplay: m.bcc ? m.bcc.map(t => t.name || t.address).join(', ') : '',
                })),
                total: this.totalMessages,
                page: this.currentPage,
                limit: limit,
                folderPath: this.folderPath,
                locale: locale,
                displayMode: displayMode,
                activeUid: this.activeUid,
                folderSettings: this.getFolderSettings(),
                customFolders: this.accountManager.getAccount(this.accountId)?.customFolders || [],
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to load messages';
            this.panel.webview.postMessage({
                type: 'error',
                message: errorMsg,
            });
        }
    }

    public static setActiveUid(accountId: string, folderPath: string, uid: number) {
        const panel = this.getPanel(accountId, folderPath);
        if (panel) {
            panel.activeUid = uid;
            panel.panel.webview.postMessage({ type: 'setActive', uid });
        }
    }

    private static getPanel(accountId: string, folderPath: string): MessageListPanel | undefined {
        const key = `${accountId}:${folderPath}`;
        let panel = MessageListPanel.panels.get(key);
        if (!panel && MessageListPanel.activePanel && MessageListPanel.activePanel.accountId === accountId && MessageListPanel.activePanel.folderPath === folderPath) {
            panel = MessageListPanel.activePanel;
        }
        return panel;
    }

    public static getNextMessageUid(accountId: string, folderPath: string, currentUid: number): number | undefined {
        const panel = this.getPanel(accountId, folderPath);

        if (panel) {
            const msgs = panel.currentMessages;
            const idx = msgs.findIndex(m => m.uid === currentUid);
            if (idx >= 0 && idx + 1 < msgs.length) {
                return msgs[idx + 1].uid;
            } else if (idx > 0) {
                return msgs[idx - 1].uid;
            }
        }
        return undefined;
    }

    private embeddedDetailPanel?: MessageDetailPanel;

    private clearEmbeddedDetail() {
        if (this.embeddedDetailPanel) {
            this.embeddedDetailPanel.dispose();
            this.embeddedDetailPanel = undefined;
            // Restore HTML for the list view since we're navigating away from the embedded view
            this.panel.webview.html = this.getHtmlContent();
        }
    }

    private showDetailEmbedded(uid: number) {
        this.clearEmbeddedDetail();

        const onBack = () => {
            this.embeddedDetailPanel = undefined;
            
            const folderInfo = this.explorerProvider.getFolderInfo(this.accountId, this.folderPath);
            this.updateTitle(folderInfo?.unseenMessages);
            
            this.panel.webview.html = this.getHtmlContent();
            this.loadMessages(); // Re-fetch or re-render list
        };

        this.embeddedDetailPanel = MessageDetailPanel.createEmbedded(
            this.panel,
            this.explorerProvider,
            this.accountManager,
            this.accountId,
            this.folderPath,
            uid,
            onBack
        );
    }

    public openMessage(uid: number): void {
        this.activeUid = uid;
        this.panel.webview.postMessage({ type: 'setActive', uid: uid });

        const config = vscode.workspace.getConfiguration('mailClient');
        const displayMode = config.get<string>('messageDisplayMode', 'preview');

        if (displayMode === 'preview') {
            this.showDetailEmbedded(uid);
        } else if (displayMode === 'split') {
            MessageDetailPanel.showInSplit(
                this.explorerProvider,
                this.accountManager,
                this.accountId,
                this.folderPath,
                uid
            );
        } else {
            // window mode
            vscode.commands.executeCommand('mailClient.openMessage', {
                accountId: this.accountId,
                folderPath: this.folderPath,
                uid: uid,
            });
        }
    }

    private handleMessage(message: any): void {
        if (this.embeddedDetailPanel) {
            return; // let the embedded panel handle its own messages
        }

        switch (message.type) {
            case 'openMessage':
                this.openMessage(message.uid);
                break;
            case 'reply':
                vscode.commands.executeCommand('mailClient.reply', {
                    accountId: this.accountId,
                    folderPath: this.folderPath,
                    uid: message.uid,
                });
                break;
            case 'replyAll':
                vscode.commands.executeCommand('mailClient.replyAll', {
                    accountId: this.accountId,
                    folderPath: this.folderPath,
                    uid: message.uid,
                });
                break;
            case 'forward':
                vscode.commands.executeCommand('mailClient.forward', {
                    accountId: this.accountId,
                    folderPath: this.folderPath,
                    uid: message.uid,
                });
                break;
            case 'refresh':
                this.loadMessages();
                break;
            case 'search':
                this.currentSearchQuery = message.query || '';
                this.currentPage = 1;
                this.loadMessages();
                break;
            case 'prevPage':
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.loadMessages();
                }
                break;
            case 'nextPage':
                this.currentPage++;
                this.loadMessages();
                break;
            case 'compose':
                vscode.commands.executeCommand('mailClient.compose', {
                    accountId: this.accountId,
                });
                break;
            case 'moveMessageFromList':
                this.moveMessageFromList(message.uid, message.action);
                break;
            case 'moveCustomFromList':
                this.moveCustomFromList(message.uid, message.target);
                break;
            case 'deleteFromList':
                this.deleteFromList(message.uid);
                break;
        }
    }

    private async moveMessageFromList(
        uid: number,
        action: 'archive' | 'spam' | 'trash' | 'newsletters' | 'inbox'
    ): Promise<void> {
        const settings = this.getFolderSettings();
        const targetFolder = settings[action];

        if (!targetFolder) {
            vscode.window.showWarningMessage(`No folder configured for "${action}". Check account settings.`);
            return;
        }

        if (this.folderPath === targetFolder) {
            vscode.window.showInformationMessage(`Already in ${action} folder.`);
            return;
        }

        try {
            const service = this.explorerProvider.getImapService(this.accountId);
            const newUid = await service.moveMessage(this.folderPath, uid, targetFolder);

            const undoLabel = `Undo`;
            const actions = newUid ? [undoLabel] : [];
            vscode.window.showInformationMessage(`Moved to ${targetFolder}`, ...actions).then(selection => {
                if (selection === undoLabel && newUid) {
                    service.moveMessage(targetFolder, newUid, this.folderPath).then((restoredUid) => {
                        vscode.window.showInformationMessage(`Moved back to ${this.folderName}`);
                        if (restoredUid) {
                            this.activeUid = restoredUid;
                            this.openMessage(restoredUid);
                        }
                        this.loadMessages();
                        this.explorerProvider.refresh();
                    }).catch(err => {
                        vscode.window.showErrorMessage(`Failed to undo move: ${err.message}`);
                    });
                }
            });

            // Notify webview to remove the row immediately (scroll-preserving)
            this.panel.webview.postMessage({ type: 'removeMessage', uid });

            // Remove from local cache so next/prev navigation stays correct
            this.currentMessages = this.currentMessages.filter(m => m.uid !== uid);
            this.totalMessages = Math.max(0, this.totalMessages - 1);

            this.explorerProvider.refresh();

            // Full refresh in background to sync real state
            this.loadMessages();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Move failed';
            vscode.window.showErrorMessage(`Failed to move message: ${errorMsg}`);
        }
    }

    private async deleteFromList(uid: number): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Are you sure you want to PERMANENTLY delete this message?',
            { modal: true },
            'Delete Forever',
        );
        if (confirm !== 'Delete Forever') return;

        try {
            const service = this.explorerProvider.getImapService(this.accountId);
            await service.deleteMessage(this.folderPath, uid);
            vscode.window.showInformationMessage('Message permanently deleted.');
            this.panel.webview.postMessage({ type: 'removeMessage', uid });
            this.currentMessages = this.currentMessages.filter(m => m.uid !== uid);
            this.totalMessages = Math.max(0, this.totalMessages - 1);
            this.explorerProvider.refresh();
            this.loadMessages();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Delete failed';
            vscode.window.showErrorMessage(`Failed to delete message: ${errorMsg}`);
        }
    }

    private async moveCustomFromList(uid: number, targetPath: string): Promise<void> {
        if (!targetPath) return;
        if (this.folderPath === targetPath) {
            vscode.window.showInformationMessage(`Already in this folder.`);
            return;
        }
        try {
            const service = this.explorerProvider.getImapService(this.accountId);
            const newUid = await service.moveMessage(this.folderPath, uid, targetPath);
            
            const undoLabel = `Undo`;
            const actions = newUid ? [undoLabel] : [];
            vscode.window.showInformationMessage(`Moved to ${targetPath}`, ...actions).then(selection => {
                if (selection === undoLabel && newUid) {
                    service.moveMessage(targetPath, newUid, this.folderPath).then((restoredUid) => {
                        vscode.window.showInformationMessage(`Moved back to ${this.folderName}`);
                        if (restoredUid) {
                            this.activeUid = restoredUid;
                            this.openMessage(restoredUid);
                        }
                        this.loadMessages();
                        this.explorerProvider.refresh();
                    }).catch(err => {
                        vscode.window.showErrorMessage(`Failed to undo move: ${err.message}`);
                    });
                }
            });
            this.panel.webview.postMessage({ type: 'removeMessage', uid });
            this.currentMessages = this.currentMessages.filter(m => m.uid !== uid);
            this.totalMessages = Math.max(0, this.totalMessages - 1);
            this.explorerProvider.refresh();
            this.loadMessages();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Move failed';
            vscode.window.showErrorMessage(`Failed to move message: ${errorMsg}`);
        }
    }

    getHtmlContent(): string {
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Messages</title>
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
        
        /* Toolbar */
        .toolbar {
            display: flex;
            align-items: center;
            padding: 0;
            border-bottom: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editorWidget-background);
            flex-shrink: 0;
            z-index: 10;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            height: 36px;
        }
        .toolbar-title {
            font-weight: 600;
            flex: 1;
            font-size: 1.1em;
            letter-spacing: 0.5px;
            padding: 0 16px;
        }
        .toolbar button {
            background: transparent;
            color: var(--vscode-foreground);
            border: none;
            border-left: 1px solid var(--vscode-widget-border);
            cursor: pointer;
            padding: 0 12px;
            border-radius: 0;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            gap: 4px;
            height: 100%;
            transition: none;
        }
        .toolbar button:hover {
            background: #e68a00 !important; /* Slightly darker orange on hover */
            color: #ffffff !important;
        }

        /* Action Buttons */
        #btnCompose, #btnRefresh {
            color: var(--vscode-foreground);
            border-left: none;
            padding: 0;
            width: 42px;
            justify-content: center;
        }
        #btnPrevPage, #btnNextPage {
            color: var(--vscode-foreground);
            padding: 0;
            width: 42px;
            justify-content: center;
            border-left: 1px solid var(--vscode-widget-border);
            height: 100%;
        }
        #btnCompose {
            background: #ff9800;
            color: #ffffff;
            font-weight: 600;
        }
        #btnCompose:hover {
            background: #e68a00 !important;
        }
        #btnCompose svg, #btnRefresh svg, #btnPrevPage svg, #btnNextPage svg {
            width: 20px;
            height: 20px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        #pageInfo {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: 600;
            margin: 0 16px;
            white-space: nowrap;
            flex-shrink: 0;
            display: inline-block;
        }

        /* Search Box */
        .search-container {
            display: flex;
            align-items: center;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            margin-right: 12px;
            height: 24px;
        }
        .search-container input {
            background: transparent;
            border: none;
            color: var(--vscode-input-foreground);
            padding: 0 6px;
            width: 180px;
            font-family: inherit;
            font-size: 0.9em;
            outline: none;
        }
        .search-container input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .search-container button {
            border: none;
            background: transparent;
            padding: 0 6px;
            cursor: pointer;
            color: var(--vscode-input-foreground);
            font-size: 1.1em;
            display: flex;
            align-items: center;
            height: 100%;
        }
        .search-container button:hover {
            color: var(--vscode-errorForeground) !important;
            background: transparent !important;
        }

        #content {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            position: relative;
        }

        /* Message List */
        .message-list {
            display: flex;
            flex-direction: column;
            width: 100%;
        }
        
        .message-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 16px;
            border-bottom: 1px solid #333333; /* Dark gray separator */
            cursor: pointer;
            transition: background-color 0.1s ease;
            position: relative;
        }
        
        .message-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        /* Active (Opened) Indicator */
        .message-item.active {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .message-item.active .message-subject,
        .message-item.active .message-from,
        .message-item.active .message-date {
            color: var(--vscode-list-activeSelectionForeground);
        }
        
        /* Unread Indicator & Styling */
        .message-item.unread {
            background-color: var(--vscode-list-hoverBackground); /* Highlighting unread slightly */
        }
        .message-item.unread::before {
            content: "";
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 4px;
            background-color: var(--vscode-progressBar-background);
        }
        
        /* Message Content Structure */
        .message-content {
            flex: 1;
            min-width: 0; /* Important for text-overflow to work in flex child */
            margin-right: 12px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            position: relative; /* needed for absolute actions overlay */
        }
        
        .message-header {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
        }
        
        .message-from {
            font-weight: 600;
            font-size: 0.95em;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-right: 10px;
        }
        
        .message-date {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            flex-shrink: 0;
        }
        
        .message-row-bottom {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .message-subject {
            color: var(--vscode-foreground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 1.1em;
            font-weight: 500;
            letter-spacing: 0.2px;
            flex: 1;
        }
        
        .message-item.unread .message-subject {
            font-weight: 700;
        }
        
        .message-item.unread .message-from {
            color: var(--vscode-foreground);
        }

        /* Badges */
        .badges {
            display: flex;
            gap: 6px;
            margin-left: 8px;
            align-items: center;
            flex-shrink: 0;
        }
        
        .icon-attachment {
            display: flex;
            align-items: center;
            opacity: 0.7;
        }
        
        .icon-attachment svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }
        
        /* Actions – absolute overlay inside .message-content, left of the date */
        .message-actions {
            display: flex;
            gap: 0;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s;
            position: absolute;
            right: 52px;    /* offset left so the date stays visible */
            top: 50%;
            transform: translateY(-50%);
            height: 30px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            overflow: hidden;
            background: var(--vscode-editorWidget-background);
            box-shadow: 0 1px 6px rgba(0,0,0,0.18);
            z-index: 2;
        }
        
        /* Show actions on hover */
        .message-item:hover .message-actions {
            opacity: 1;
            pointer-events: auto;
        }
        
        .action-btn {
            background: transparent;
            border: none;
            border-right: 1px solid var(--vscode-widget-border);
            color: var(--vscode-foreground);
            cursor: pointer;
            width: 30px;
            height: 100%;
            border-radius: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: none;
            padding: 0;
            white-space: nowrap;
            font-size: 0.78em;
        }
        .action-btn:last-child {
            border-right: none;
        }
        
        .action-btn svg {
            width: 18px;
            height: 18px;
            fill: none; /* Keep SVG stroke-based outline style */
            stroke: currentColor;
        }
        
        .action-btn:hover {
            background-color: #ff9800 !important;
            color: #ffffff !important;
            transform: none;
        }
        
        .loading, .error-msg, .empty-msg {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
            font-size: 1.1em;
        }
        .error-msg { color: var(--vscode-errorForeground); }

        #btnPrevPage:disabled, #btnNextPage:disabled {
            opacity: 0.3 !important;
            cursor: default !important;
            background: transparent !important;
            color: var(--vscode-foreground) !important;
        }

        /* Loading Spinner */
        .loader {
            width: 18px;
            height: 18px;
            border: 2px solid var(--vscode-descriptionForeground);
            border-bottom-color: transparent;
            border-radius: 50%;
            display: inline-block;
            box-sizing: border-box;
            animation: rotation 1s linear infinite;
            vertical-align: middle;
            margin-right: 8px;
        }

        @keyframes rotation {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        /* Hide reply-group (Reply/Forward) if display mode is 'split' – move buttons always visible */
        body.mode-split .reply-group {
            display: none !important;
        }

        /* Move action buttons */
        .action-btn.btn-inbox    { --btn-color: #4caf50; }
        .action-btn.btn-archive  { --btn-color: #2196f3; }
        .action-btn.btn-newsletters { --btn-color: #9c27b0; }
        .action-btn.btn-spam     { --btn-color: #ff9800; }
        .action-btn.btn-trash    { --btn-color: #f44336; }
        .action-btn.btn-delete   { --btn-color: #c62828; }

        .action-btn:hover {
            background-color: var(--btn-color, #ff9800) !important;
            color: #ffffff !important;
        }

        /* Separator between move-group and reply-group */
        .action-btn.btn-separator {
            width: 1px;
            background: var(--vscode-widget-border) !important;
            cursor: default;
            padding: 0;
            pointer-events: none;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <span class="toolbar-title" id="folderTitle">Messages</span>
        
        <div id="paginationContainer" style="display: none; align-items: center; height: 100%;">
            <span id="pageInfo"></span>
            <button id="btnPrevPage" title="Previous Page">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button id="btnNextPage" title="Next Page">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
        </div>

        <div class="search-container">
            <input type="text" id="searchInput" placeholder="Search in folder..." title="Type query and press Enter to search using IMAP" value="${this.currentSearchQuery ? this.currentSearchQuery.replace(/"/g, '&quot;') : ''}" />
            <button id="btnClearSearch" title="Clear Search" style="display: ${this.currentSearchQuery ? 'block' : 'none'};">✕</button>
        </div>
        <button id="btnRefresh" title="Refresh"><svg viewBox="0 0 24 24"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button>
        <button id="btnCompose" title="New Message"><svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg></button>
    </div>

    <div id="content">
        <div class="loading"><span class="loader"></span>Loading messages...</div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const contentEl = document.getElementById('content');
        const titleEl = document.getElementById('folderTitle');
        const searchInput = document.getElementById('searchInput');
        const btnClearSearch = document.getElementById('btnClearSearch');

        document.getElementById('btnRefresh').addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });

        document.getElementById('btnCompose').addEventListener('click', () => {
            vscode.postMessage({ type: 'compose' });
        });

        document.getElementById('btnPrevPage').addEventListener('click', () => {
            vscode.postMessage({ type: 'prevPage' });
        });

        document.getElementById('btnNextPage').addEventListener('click', () => {
            vscode.postMessage({ type: 'nextPage' });
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) {
                    btnClearSearch.style.display = 'block';
                } else {
                    btnClearSearch.style.display = 'none';
                }
                vscode.postMessage({ type: 'search', query: query });
            }
        });

        btnClearSearch.addEventListener('click', () => {
            searchInput.value = '';
            btnClearSearch.style.display = 'none';
            vscode.postMessage({ type: 'search', query: '' });
        });

        let currentLocale = undefined;

        function formatDate(isoStr) {
            const d = new Date(isoStr);
            const today = new Date();
            const loc = currentLocale || [];
            
            // If today, show time only
            if (d.toDateString() === today.toDateString()) {
                return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
            }
            
            // If this year, show Date Month (e.g., 24 Oct)
            if (d.getFullYear() === today.getFullYear()) {
                return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' });
            }
            
            // Otherwise show full date
            return d.toLocaleDateString(loc, { day: 'numeric', month: 'numeric', year: 'numeric' });
        }

        function escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        // SVG Icons
        // Simple small paperclip
        const ICON_ATTACHMENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>';
        
        // Thick Arrow Left (<) for Reply (5px stroke)
        const ICON_REPLY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6L9 12L15 18"></path></svg>';
        
        // Thick Double Arrow Left (<<) for Reply All (5px stroke)
        const ICON_REPLY_ALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6L11 12L17 18"></path><path d="M10 6L4 12L10 18"></path></svg>';
        
        // Thick Arrow Right (>) for Forward (5px stroke)
        const ICON_FORWARD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6L15 12L9 18"></path></svg>';

        // Inbox: arrow into tray
        const ICON_INBOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>';

        // Archive: box with down arrow
        const ICON_ARCHIVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';

        // Newsletters: newspaper / lines
        const ICON_NEWSLETTERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>';

        // Spam: warning triangle with exclamation
        const ICON_SPAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

        // Trash: bin
        const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

        // Delete permanently: X over bin
        const ICON_DELETE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="14" y2="15"/><line x1="14" y1="11" x2="10" y2="15"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

        // Custom Folder: folder outline
        const ICON_CUSTOM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

        function renderMessages(messages) {
            if (messages.length === 0) {
                contentEl.innerHTML = '<div class="empty-msg">No messages in this folder.</div>';
                return;
            }

            let html = '<div class="message-list">';

            for (const msg of messages) {
                const unreadClass = !msg.seen ? ' unread' : '';
                
                html += '<div class="message-item' + unreadClass + '" data-uid="' + msg.uid + '">';
                
                // Content Left/Center
                html += '  <div class="message-content">';
                
                // Top Row: From + Date
                html += '    <div class="message-header">';
                
                if (currentFolderPath && currentFolderSettings && currentFolderPath === currentFolderSettings.sent) {
                    let displayParts = [];
                    if (msg.toDisplay) displayParts.push('To: ' + escapeHtml(msg.toDisplay));
                    if (msg.ccDisplay) displayParts.push('Cc: ' + escapeHtml(msg.ccDisplay));
                    if (msg.bccDisplay) displayParts.push('Bcc: ' + escapeHtml(msg.bccDisplay));
                    
                    let displayStr = displayParts.length > 0 ? displayParts.join(' | ') : escapeHtml(msg.fromDisplay);
                    html += '      <span class="message-from">' + displayStr + '</span>';
                } else {
                    html += '      <span class="message-from">' + escapeHtml(msg.fromDisplay) + '</span>';
                }
                
                html += '      <span class="message-date">' + formatDate(msg.date) + '</span>';
                html += '    </div>';
                
                // Bottom Row: Subject + Badges
                html += '    <div class="message-row-bottom">';
                html += '      <span class="message-subject">' + escapeHtml(msg.subject) + '</span>';
                
                if (msg.hasAttachments) {
                    html += '      <div class="badges">';
                    html += '        <span class="icon-attachment" title="Has Attachments">' + ICON_ATTACHMENT + '</span>';
                    html += '      </div>';
                }
                
                html += '    </div>'; // End Bottom Row

                // Actions overlay (positioned absolutely inside .message-content, left of date)
                html += '  <div class="message-actions">';
                // Move-to-folder buttons
                html += '    <button class="action-btn btn-inbox move-btn" data-action="inbox" data-uid="' + msg.uid + '" title="Move to Inbox">' + ICON_INBOX + '</button>';
                html += '    <button class="action-btn btn-archive move-btn" data-action="archive" data-uid="' + msg.uid + '" title="Archive">' + ICON_ARCHIVE + '</button>';
                html += '    <button class="action-btn btn-newsletters move-btn" data-action="newsletters" data-uid="' + msg.uid + '" title="Move to Newsletters">' + ICON_NEWSLETTERS + '</button>';
                html += '    <button class="action-btn btn-spam move-btn" data-action="spam" data-uid="' + msg.uid + '" title="Move to Spam">' + ICON_SPAM + '</button>';
                html += '    <button class="action-btn btn-trash move-btn" data-action="trash" data-uid="' + msg.uid + '" title="Move to Trash">' + ICON_TRASH + '</button>';
                html += '    <button class="action-btn btn-delete delete-btn" data-uid="' + msg.uid + '" title="Delete Permanently" style="display:none;">' + ICON_DELETE + '</button>';
                // Custom folder buttons
                for (const cf of (currentCustomFolders || [])) {
                    html += '    <button class="action-btn move-btn" data-action="custom" data-target="' + escapeHtml(cf.path) + '" data-uid="' + msg.uid + '" title="Move to ' + escapeHtml(cf.name) + '">' + ICON_CUSTOM + '</button>';
                }
                html += '    <div class="reply-group" style="display:contents;">';
                html += '      <button class="action-btn btn-separator" aria-hidden="true"></button>';
                html += '      <button class="action-btn" data-action="forward" data-uid="' + msg.uid + '" title="Forward">' + ICON_FORWARD + '</button>';
                html += '      <button class="action-btn" data-action="reply" data-uid="' + msg.uid + '" title="Reply">' + ICON_REPLY + '</button>';
                html += '      <button class="action-btn" data-action="replyAll" data-uid="' + msg.uid + '" title="Reply All">' + ICON_REPLY_ALL + '</button>';
                html += '    </div>';
                html += '  </div>';

                html += '  </div>'; // End Content

                html += '</div>'; // End Item
            }

            html += '</div>'; // End List
            contentEl.innerHTML = html;

            // Add click handlers
            contentEl.querySelectorAll('.message-item').forEach(row => {
                row.addEventListener('click', (e) => {
                    // Ignore clicks on action buttons
                    if (e.target.closest('.action-btn')) return;
                    vscode.postMessage({ type: 'openMessage', uid: parseInt(row.dataset.uid) });
                });
            });

            contentEl.querySelectorAll('.action-btn').forEach(btn => {
                if (btn.classList.contains('btn-separator')) return;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    if (btn.classList.contains('delete-btn')) {
                        vscode.postMessage({ type: 'deleteFromList', uid: parseInt(btn.dataset.uid) });
                    } else if (action === 'custom') {
                        vscode.postMessage({ type: 'moveCustomFromList', uid: parseInt(btn.dataset.uid), target: btn.dataset.target });
                    } else if (btn.classList.contains('move-btn')) {
                        vscode.postMessage({ type: 'moveMessageFromList', uid: parseInt(btn.dataset.uid), action: action });
                    } else {
                        vscode.postMessage({ type: action, uid: parseInt(btn.dataset.uid) });
                    }
                });
            });
        }

        // Apply folder settings visibility to move buttons
        function applyFolderSettings(folderPath, folderSettings) {
            if (!folderSettings) return;
            const actionMap = {
                inbox: folderSettings.inbox || 'INBOX',
                archive: folderSettings.archive || 'Archive',
                newsletters: folderSettings.newsletters || 'Newsletters',
                spam: folderSettings.spam || 'Spam',
                trash: folderSettings.trash || 'Trash',
            };
            const normalizedCurrent = folderPath ? folderPath.toUpperCase() : '';
            Object.entries(actionMap).forEach(([action, targetPath]) => {
                const normalizedTarget = targetPath ? targetPath.toUpperCase() : '';
                const isCurrentFolder = normalizedCurrent === normalizedTarget ||
                    (action === 'inbox' && normalizedCurrent === 'INBOX');
                const selector = '.move-btn[data-action="' + action + '"]';
                contentEl.querySelectorAll(selector).forEach(btn => {
                    btn.style.display = isCurrentFolder ? 'none' : '';
                });
            });
            // Custom folder buttons: hide if current path matches
            contentEl.querySelectorAll('.move-btn[data-action="custom"]').forEach(btn => {
                btn.style.display = btn.dataset.target === folderPath ? 'none' : '';
            });
            // Show Delete Permanently button only in Trash
            const trashPath = (folderSettings.trash || 'Trash').toUpperCase();
            const inTrash = normalizedCurrent === trashPath;
            contentEl.querySelectorAll('.delete-btn').forEach(btn => {
                btn.style.display = inTrash ? '' : 'none';
            });
        }

        let currentFolderPath = '';
        let currentFolderSettings = {};
        let currentCustomFolders = [];


        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'loading':
                    contentEl.innerHTML = '<div class="loading"><span class="loader"></span>Loading messages...</div>';
                    break;
                case 'messages': {
                    let titleText = msg.folderPath;
                    if (searchInput.value.trim()) {
                        titleText += ' (Search results)';
                    }
                    titleEl.textContent = titleText;
                    if (msg.locale) { currentLocale = msg.locale; }
                    if (msg.displayMode) { document.body.className = 'mode-' + msg.displayMode; }
                    if (msg.folderPath) { currentFolderPath = msg.folderPath; }
                    if (msg.folderSettings) { currentFolderSettings = msg.folderSettings; }
                    if (msg.customFolders) { currentCustomFolders = msg.customFolders; }
                    
                    const paginationEl = document.getElementById('paginationContainer');
                    const pageInfoEl = document.getElementById('pageInfo');
                    const btnPrevPage = document.getElementById('btnPrevPage');
                    const btnNextPage = document.getElementById('btnNextPage');
                    
                    if (msg.total > 0) {
                        paginationEl.style.display = 'flex';
                        const totalPages = Math.ceil(msg.total / msg.limit);
                        
                        if (totalPages <= 1) {
                            pageInfoEl.textContent = msg.total + ' messages';
                            btnPrevPage.style.display = 'none';
                            btnNextPage.style.display = 'none';
                        } else {
                            pageInfoEl.textContent = 'Page ' + msg.page + ' of ' + totalPages + ' (' + msg.total + ')';
                            btnPrevPage.style.display = 'flex';
                            btnNextPage.style.display = 'flex';
                            btnPrevPage.disabled = msg.page <= 1;
                            btnNextPage.disabled = msg.page >= totalPages;
                        }
                    } else {
                        paginationEl.style.display = 'none';
                    }

                    // Preserve scroll position
                    const savedScroll = contentEl.scrollTop;
                    renderMessages(msg.messages);
                    contentEl.scrollTop = savedScroll;

                    applyFolderSettings(currentFolderPath, currentFolderSettings);

                    if (msg.activeUid !== undefined) {
                        const item = document.querySelector('.message-item[data-uid="' + msg.activeUid + '"]');
                        if (item) item.classList.add('active');
                    }
                    break;
                }
                case 'setActive':
                    document.querySelectorAll('.message-item').forEach(el => el.classList.remove('active'));
                    if (msg.uid !== undefined) {
                        const activeItem = document.querySelector('.message-item[data-uid="' + msg.uid + '"]');
                        if (activeItem) activeItem.classList.add('active');
                    }
                    break;
                case 'removeMessage': {
                    // Remove row immediately without losing scroll position
                    const row = document.querySelector('.message-item[data-uid="' + msg.uid + '"]');
                    if (row) {
                        row.style.transition = 'opacity 0.15s';
                        row.style.opacity = '0';
                        setTimeout(() => row.remove(), 150);
                    }
                    break;
                }
                case 'error':
                    contentEl.innerHTML = '<div class="error-msg">Error: ' + escapeHtml(msg.message) + '</div>';
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
    
    private dispose(): void {
        const key = `${this.accountId}:${this.folderPath}`;
        MessageListPanel.panels.delete(key);
        if (MessageListPanel.activePanel === this) {
            MessageListPanel.activePanel = undefined;
        }
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

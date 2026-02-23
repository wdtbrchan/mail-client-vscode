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
    static refreshFolder(accountId: string, folderPath: string): void {
        const key = `${accountId}:${folderPath}`;
        const panel = MessageListPanel.panels.get(key);
        if (panel) {
            panel.loadMessages();
        }
    }

    private async loadMessages(): Promise<void> {
        try {
            this.panel.webview.postMessage({ type: 'loading' });

            const service = this.explorerProvider.getImapService(this.accountId);
            const messages = await service.getMessages(this.folderPath);

            const config = vscode.workspace.getConfiguration('mailClient');
            const locale = config.get<string>('locale') || undefined;
            const displayMode = config.get<string>('messageDisplayMode', 'split');

            this.panel.webview.postMessage({
                type: 'messages',
                messages: messages.map(m => ({
                    ...m,
                    date: m.date.toISOString(),
                    fromDisplay: m.from.name || m.from.address,
                    toDisplay: m.to.map(t => t.name || t.address).join(', '),
                })),
                folderPath: this.folderPath,
                locale: locale,
                displayMode: displayMode,
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to load messages';
            this.panel.webview.postMessage({
                type: 'error',
                message: errorMsg,
            });
        }
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
            this.panel.title = this.folderName;
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

    private handleMessage(message: any): void {
        if (this.embeddedDetailPanel) {
            return; // let the embedded panel handle its own messages
        }

        switch (message.type) {
            case 'openMessage':
                const config = vscode.workspace.getConfiguration('mailClient');
                const displayMode = config.get<string>('messageDisplayMode', 'preview');

                if (displayMode === 'preview') {
                    this.showDetailEmbedded(message.uid);
                } else if (displayMode === 'split') {
                    MessageDetailPanel.showInSplit(
                        this.explorerProvider,
                        this.accountManager,
                        this.accountId,
                        this.folderPath,
                        message.uid
                    );
                } else {
                    // window mode
                    vscode.commands.executeCommand('mailClient.openMessage', {
                        accountId: this.accountId,
                        folderPath: this.folderPath,
                        uid: message.uid,
                    });
                }
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
            case 'compose':
                vscode.commands.executeCommand('mailClient.compose', {
                    accountId: this.accountId,
                });
                break;
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
            overflow-x: hidden; /* Prevent horizontal scroll */
        }
        
        /* Toolbar */
        .toolbar {
            display: flex;
            align-items: center;
            padding: 0;
            border-bottom: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editorWidget-background);
            position: sticky;
            top: 0;
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

        /* Highlight New Message button */
        #btnCompose {
            background: #ff9800;
            color: #ffffff;
            border-left: none;
            padding: 0 16px;
            font-weight: 600;
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
        }
        
        .message-header {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
        }
        
        .message-from {
            font-weight: 600;
            font-size: 1.05em;
            color: var(--vscode-foreground);
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
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 0.95em;
            flex: 1;
        }
        
        .message-item.unread .message-subject {
            color: var(--vscode-foreground);
            font-weight: 500;
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
        
        /* Actions */
        .message-actions {
            display: flex;
            gap: 0;
            opacity: 0; /* Hidden by default */
            transition: opacity 0.2s;
            margin-left: 8px;
            height: 36px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            overflow: hidden;
            background: var(--vscode-editorWidget-background);
        }
        
        /* Show actions on hover */
        .message-item:hover .message-actions {
            opacity: 1;
        }
        
        .action-btn {
            background: transparent;
            border: none;
            border-right: 1px solid var(--vscode-widget-border);
            color: var(--vscode-foreground);
            cursor: pointer;
            width: 36px;
            height: 100%;
            border-radius: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: none;
            padding: 0;
        }
        .action-btn:last-child {
            border-right: none;
        }
        
        .action-btn svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
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
        
        /* Hide actions if display mode is 'split' */
        body.mode-split .message-actions {
            display: none !important;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <span class="toolbar-title" id="folderTitle">Messages</span>
        <button id="btnCompose" title="New Message">✉ New Message</button>
        <button id="btnRefresh" title="Refresh">↻ Refresh</button>
    </div>

    <div id="content">
        <div class="loading"><span class="loader"></span>Loading messages...</div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const contentEl = document.getElementById('content');
        const titleEl = document.getElementById('folderTitle');

        document.getElementById('btnRefresh').addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });

        document.getElementById('btnCompose').addEventListener('click', () => {
            vscode.postMessage({ type: 'compose' });
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
                html += '      <span class="message-from">' + escapeHtml(msg.fromDisplay) + '</span>';
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
                html += '  </div>'; // End Content
                
                // Actions Right
                html += '  <div class="message-actions">';
                html += '    <button class="action-btn" data-action="forward" data-uid="' + msg.uid + '" title="Forward">' + ICON_FORWARD + '</button>';
                html += '    <button class="action-btn" data-action="reply" data-uid="' + msg.uid + '" title="Reply">' + ICON_REPLY + '</button>';
                html += '    <button class="action-btn" data-action="replyAll" data-uid="' + msg.uid + '" title="Reply All">' + ICON_REPLY_ALL + '</button>';
                html += '  </div>';

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
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ type: btn.dataset.action, uid: parseInt(btn.dataset.uid) });
                });
            });
        }

        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'loading':
                    contentEl.innerHTML = '<div class="loading"><span class="loader"></span>Loading messages...</div>';
                    break;
                case 'messages':
                    titleEl.textContent = msg.folderPath;
                    if (msg.locale) { currentLocale = msg.locale; }
                    if (msg.displayMode) { document.body.className = 'mode-' + msg.displayMode; }
                    renderMessages(msg.messages);
                    break;
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

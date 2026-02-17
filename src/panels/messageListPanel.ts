import * as vscode from 'vscode';
import { MailExplorerProvider, MailTreeItem } from '../providers/mailExplorerProvider';
import { IMailMessage } from '../types/message';

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
        private accountId: string,
        private folderPath: string,
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
        accountId: string,
        folderPath: string,
        folderName: string,
    ): MessageListPanel {
        if (MessageListPanel.activePanel) {
            const active = MessageListPanel.activePanel;
            // Remove old key from panels map
            const oldKey = `${active.accountId}:${active.folderPath}`;
            MessageListPanel.panels.delete(oldKey);
            // Update to new folder
            active.accountId = accountId;
            active.folderPath = folderPath;
            active.panel.title = folderName;
            // Register under new key
            const newKey = `${accountId}:${folderPath}`;
            MessageListPanel.panels.set(newKey, active);
            active.panel.reveal();
            active.loadMessages();
            return active;
        }

        const instance = MessageListPanel.show(explorerProvider, accountId, folderPath, folderName);
        MessageListPanel.activePanel = instance;
        return instance;
    }

    /**
     * Opens or reveals a message list panel for the given folder in a new tab.
     */
    static show(
        explorerProvider: MailExplorerProvider,
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

        const instance = new MessageListPanel(panel, explorerProvider, accountId, folderPath);
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

            const locale = vscode.workspace.getConfiguration('mailClient').get<string>('locale') || undefined;

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
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to load messages';
            this.panel.webview.postMessage({
                type: 'error',
                message: errorMsg,
            });
        }
    }

    private handleMessage(message: any): void {
        switch (message.type) {
            case 'openMessage':
                vscode.commands.executeCommand('mailClient.openMessage', {
                    accountId: this.accountId,
                    folderPath: this.folderPath,
                    uid: message.uid,
                });
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
        }
        .toolbar {
            display: flex;
            align-items: center;
            padding: 8px 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editorWidget-background);
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .toolbar-title {
            font-weight: 600;
            flex: 1;
        }
        .toolbar button {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 1em;
        }
        .toolbar button:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        .message-table {
            width: 100%;
            border-collapse: collapse;
        }
        .message-table th {
            text-align: left;
            padding: 8px 12px;
            border-bottom: 2px solid var(--vscode-widget-border);
            font-weight: 600;
            font-size: 0.85em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            position: sticky;
            top: 40px;
            background: var(--vscode-editor-background);
        }
        .message-table td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
            vertical-align: middle;
        }
        .message-row {
            cursor: pointer;
            transition: background-color 0.1s;
        }
        .message-row:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .message-row.unread {
            font-weight: 600;
        }
        .message-row.unread td:first-child::before {
            content: "●";
            color: var(--vscode-notificationsInfoIcon-foreground);
            margin-right: 6px;
            font-size: 0.7em;
        }
        .col-date { width: 140px; white-space: nowrap; }
        .col-from { width: 200px; }
        .col-subject { min-width: 200px; }
        .col-attachment { width: 30px; text-align: center; }
        .col-actions { width: 120px; white-space: nowrap; }
        .attachment-icon { opacity: 0.7; }
        .action-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 3px;
            opacity: 0.6;
            font-size: 0.85em;
        }
        .action-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
            opacity: 1;
        }
        .loading, .error-msg, .empty-msg {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .error-msg { color: var(--vscode-errorForeground); }
    </style>
</head>
<body>
    <div class="toolbar">
        <span class="toolbar-title" id="folderTitle">Messages</span>
        <button id="btnCompose" title="New Message">✉ New Message</button>
        <button id="btnRefresh" title="Refresh">↻ Refresh</button>
    </div>

    <div id="content">
        <div class="loading">Loading messages...</div>
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
            const isToday = d.toDateString() === today.toDateString();
            if (isToday) {
                return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' })
                + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        function renderMessages(messages) {
            if (messages.length === 0) {
                contentEl.innerHTML = '<div class="empty-msg">No messages in this folder.</div>';
                return;
            }

            let html = '<table class="message-table"><thead><tr>'
                + '<th class="col-date">Date</th>'
                + '<th class="col-from">From</th>'
                + '<th class="col-subject">Subject</th>'
                + '<th class="col-attachment">📎</th>'
                + '<th class="col-actions">Actions</th>'
                + '</tr></thead><tbody>';

            for (const msg of messages) {
                const unread = !msg.seen ? ' unread' : '';
                html += '<tr class="message-row' + unread + '" data-uid="' + msg.uid + '">'
                    + '<td class="col-date">' + formatDate(msg.date) + '</td>'
                    + '<td class="col-from">' + escapeHtml(msg.fromDisplay) + '</td>'
                    + '<td class="col-subject">' + escapeHtml(msg.subject) + '</td>'
                    + '<td class="col-attachment">' + (msg.hasAttachments ? '<span class="attachment-icon">📎</span>' : '') + '</td>'
                    + '<td class="col-actions">'
                    + '<button class="action-btn" data-action="reply" data-uid="' + msg.uid + '" title="Reply">↩</button>'
                    + '<button class="action-btn" data-action="replyAll" data-uid="' + msg.uid + '" title="Reply All">↩↩</button>'
                    + '<button class="action-btn" data-action="forward" data-uid="' + msg.uid + '" title="Forward">↪</button>'
                    + '</td></tr>';
            }

            html += '</tbody></table>';
            contentEl.innerHTML = html;

            // Add click handlers
            contentEl.querySelectorAll('.message-row').forEach(row => {
                row.addEventListener('click', (e) => {
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
                    contentEl.innerHTML = '<div class="loading">Loading messages...</div>';
                    break;
                case 'messages':
                    titleEl.textContent = msg.folderPath;
                    if (msg.locale) { currentLocale = msg.locale; }
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

import * as vscode from 'vscode';
import { MailExplorerProvider } from '../providers/mailExplorerProvider';
import { AccountManager } from '../services/accountManager';
import { MessageListPanel } from './messageListPanel';
import { IMailMessageDetail } from '../types/message';

/**
 * Webview panel for displaying a full email message with reply capabilities.
 * Shows message headers, HTML/text body, and a WYSIWYG reply editor.
 */
export class MessageDetailPanel {
    public static readonly viewType = 'mailClient.messageDetail';
    private static panels = new Map<string, MessageDetailPanel>();

    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly explorerProvider: MailExplorerProvider,
        private readonly accountManager: AccountManager,
        private readonly accountId: string,
        private readonly folderPath: string,
        private readonly uid: number,
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
    ): MessageDetailPanel {
        const key = `${accountId}:${folderPath}:${uid}`;

        const existing = MessageDetailPanel.panels.get(key);
        if (existing) {
            existing.panel.reveal();
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            MessageDetailPanel.viewType,
            'Loading...',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        const instance = new MessageDetailPanel(panel, explorerProvider, accountManager, accountId, folderPath, uid);
        MessageDetailPanel.panels.set(key, instance);
        return instance;
    }

    private async loadMessage(): Promise<void> {
        try {
            this.panel.webview.html = this.getHtmlContent();
            this.panel.webview.postMessage({ type: 'loading' });

            const service = this.explorerProvider.getImapService(this.accountId);
            const message = await service.getMessage(this.folderPath, this.uid);

            this.panel.title = message.subject || '(no subject)';

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
                    folderSettings: this.getFolderSettings(),
                    currentResidesIn: this.folderPath
                },
            });
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
                });
                break;
            case 'delete':
                this.deleteMessage();
                break;
            case 'archive':
            case 'spam':
            case 'trash':
            case 'newsletters':
                this.moveMessage(message.type);
                break;
            case 'moveCustom':
                this.moveMessageCustom(message.target);
                break;
        }
    }

    private getFolderSettings(): any {
        const account = this.accountManager.getAccount(this.accountId);
        if (!account) return {};
        
        return {
            trash: account.trashFolder || 'Trash',
            spam: account.spamFolder || 'Spam',
            archive: account.archiveFolder || 'Archive',
            newsletters: account.newslettersFolder || 'Newsletters',
            sent: account.sentFolder || 'Sent',
            drafts: account.draftsFolder || 'Drafts'
        };
    }

    private async moveMessage(action: 'archive' | 'spam' | 'trash' | 'newsletters'): Promise<void> {
        const settings = this.getFolderSettings();
        const targetFolder = settings[action];
        
        if (!targetFolder) {
            vscode.window.showWarningMessage(`No folder configured for ${action}. check account settings.`);
            return;
        }

        if (this.folderPath === targetFolder) {
             vscode.window.showInformationMessage(`Message is already in ${action} folder.`);
             return;
        }

        try {
            const service = this.explorerProvider.getImapService(this.accountId);
            await service.moveMessage(this.folderPath, this.uid, targetFolder);
            
            vscode.window.showInformationMessage(`Message moved to ${targetFolder}`);
            
            // Refresh logic similar to delete
            MessageListPanel.refreshFolder(this.accountId, this.folderPath);
            this.explorerProvider.refresh();
            this.panel.dispose();
        } catch (error) {
             const errorMsg = error instanceof Error ? error.message : 'Move failed';
            vscode.window.showErrorMessage(`Failed to move message: ${errorMsg}`);
        }
    }

    private async moveMessageCustom(targetPath: string): Promise<void> {
        try {
            const service = this.explorerProvider.getImapService(this.accountId);
            await service.moveMessage(this.folderPath, this.uid, targetPath);
            
            vscode.window.showInformationMessage(`Message moved to ${targetPath}`);
            
            MessageListPanel.refreshFolder(this.accountId, this.folderPath);
            this.explorerProvider.refresh();
            this.panel.dispose();
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
            const service = this.explorerProvider.getImapService(this.accountId);
            await service.deleteMessage(this.folderPath, this.uid);

            // Refresh the message list panel for this folder
            MessageListPanel.refreshFolder(this.accountId, this.folderPath);

            // Refresh folder tree (updates unread counts / badge)
            this.explorerProvider.refresh();

            // Close this detail panel
            this.panel.dispose();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to delete message';
            vscode.window.showErrorMessage(`Delete failed: ${errorMsg}`);
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
            `<button class="action-btn" id="btnCustom_${i}" title="Move to ${cf.name}">📂 ${cf.name}</button>`
        ).join('');

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src * data:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Message</title>
    <style nonce="${nonce}">
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }

        /* Action toolbar */
        .action-bar {
            display: flex;
            gap: 8px;
            padding: 10px 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editorWidget-background);
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .action-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            border: none;
            border-radius: 4px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            font-family: inherit;
            font-size: 0.9em;
        }
        .action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .action-btn.danger {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-errorForeground);
        }
        .action-btn.danger:hover {
            opacity: 0.85;
        }

        /* Message headers */
        .message-headers {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .header-subject {
            font-size: 1.3em;
            font-weight: 600;
            margin-bottom: 12px;
        }
        .header-row {
            display: grid;
            grid-template-columns: 60px 1fr;
            margin-bottom: 4px;
            font-size: 0.95em;
        }
        .header-label {
            color: var(--vscode-descriptionForeground);
            font-weight: 500;
        }
        .header-value {
            word-break: break-word;
        }
        .header-date {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            margin-top: 8px;
        }

        /* Attachments */
        .attachments {
            padding: 10px 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .attachment-chip {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 12px;
            font-size: 0.85em;
        }

        /* Message body */
        .message-body {
            padding: 16px;
            min-height: 200px;
            line-height: 1.6;
        }
        .message-body iframe {
            width: 100%;
            border: none;
            min-height: 300px;
        }
        .message-body pre {
            white-space: pre-wrap;
            word-break: break-word;
            font-family: var(--vscode-editor-font-family);
        }

        /* Lists */
        .message-body ul, .message-body ol {
            margin-left: 24px;
            padding-left: 10px;
        }
        .message-body li {
            margin-bottom: 4px;
        }

        /* External Images Warning */
        .images-blocked-warning {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: var(--vscode-editorInfo-background);
            color: var(--vscode-editorInfo-foreground);
            padding: 8px 16px;
            margin-bottom: 16px;
            border-radius: 4px;
            font-size: 0.9em;
        }
        .images-blocked-warning button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 12px;
            border-radius: 2px;
            cursor: pointer;
            margin-left: 10px;
        }
        .images-blocked-warning button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        /* Reply section */
        .reply-section {
            border-top: 2px solid var(--vscode-focusBorder);
            margin: 16px;
            padding-top: 16px;
        }
        .reply-header {
            font-weight: 600;
            margin-bottom: 10px;
            font-size: 0.95em;
        }
        .reply-toolbar {
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
        .format-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        .reply-editor {
            min-height: 150px;
            padding: 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 0 0 4px 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            outline: none;
            line-height: 1.5;
        }
        .reply-editor:focus {
            border-color: var(--vscode-focusBorder);
        }
        .reply-actions {
            display: flex;
            gap: 8px;
            margin-top: 10px;
            justify-content: flex-end;
        }
        .btn-send {
            padding: 8px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
        }
        .btn-send:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .loading, .error-msg {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .error-msg { color: var(--vscode-errorForeground); }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div class="action-bar">
        <button class="action-btn" id="btnReply">↩ Reply</button>
        <button class="action-btn" id="btnReplyAll">↩↩ Reply All</button>
        <button class="action-btn" id="btnForward">↪ Forward</button>
        <div style="flex: 1;"></div>
        <button class="action-btn" id="btnArchive" title="Archive">📂 Archive</button>
        <button class="action-btn" id="btnSpam" title="Mark as Spam">⛔ Spam</button>
        <button class="action-btn" id="btnNewsletters" title="Move to Newsletters">📰 News</button>
        <button class="action-btn" id="btnTrash" title="Move to Trash">🗑 Trash</button>
        <button class="action-btn danger hidden" id="btnDelete" title="Delete Permanently">❌ Delete</button>
        ${customButtonsHtml}
    </div>

    <div id="content">
        <div class="loading">Loading message...</div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const userLocale = '${locale}';
        const customFolders = ${JSON.stringify(customFolders)};
        console.log('Using locale:', userLocale);
        const contentEl = document.getElementById('content');

        document.getElementById('btnReply').addEventListener('click', () => {
            vscode.postMessage({ type: 'reply' });
            showReplyEditor('reply');
        });
        document.getElementById('btnReplyAll').addEventListener('click', () => {
            vscode.postMessage({ type: 'replyAll' });
            showReplyEditor('replyAll');
        });
        document.getElementById('btnForward').addEventListener('click', () => {
            vscode.postMessage({ type: 'forward' });
            showReplyEditor('forward');
        });
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

        // Show/Hide buttons based on current folder
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.type === 'message') {
                const settings = msg.message.folderSettings || {};
                const current = msg.message.currentResidesIn;
                
                const btnTrash = document.getElementById('btnTrash');
                const btnDelete = document.getElementById('btnDelete');
                
                if (current === settings.trash) {
                    btnTrash.classList.add('hidden');
                    btnDelete.classList.remove('hidden');
                } else {
                    btnTrash.classList.remove('hidden');
                    btnDelete.classList.add('hidden');
                }
            }
        });

        function formatDate(isoStr) {
            const d = new Date(isoStr);
            return d.toLocaleDateString(userLocale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
                + ' ' + d.toLocaleTimeString(userLocale, { hour: '2-digit', minute: '2-digit' });
        }

        function escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        function renderMessage(msg) {
            let html = '<div class="message-headers">';
            html += '<div class="header-subject">' + escapeHtml(msg.subject) + '</div>';
            html += '<div class="header-row"><span class="header-label">From:</span><span class="header-value">' + escapeHtml(msg.fromDisplay) + '</span></div>';
            html += '<div class="header-row"><span class="header-label">To:</span><span class="header-value">' + escapeHtml(msg.toDisplay) + '</span></div>';
            if (msg.ccDisplay) {
                html += '<div class="header-row"><span class="header-label">CC:</span><span class="header-value">' + escapeHtml(msg.ccDisplay) + '</span></div>';
            }
            html += '<div class="header-date">' + formatDate(msg.date) + '</div>';
            html += '</div>';

            // Attachments
            if (msg.attachments && msg.attachments.length > 0) {
                html += '<div class="attachments">';
                for (const att of msg.attachments) {
                    html += '<span class="attachment-chip">📎 ' + escapeHtml(att.filename) + '</span>';
                }
                html += '</div>';
            }

            // Body
            html += '<div class="message-body">';
            
            let bodyContent = '';
            let hasBlockedImages = false;

            if (msg.html) {
                // Parse and process HTML for external images
                const parser = new DOMParser();
                const doc = parser.parseFromString(msg.html, 'text/html');
                const images = doc.querySelectorAll('img');
                
                images.forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
                        img.setAttribute('data-original-src', src);
                        img.removeAttribute('src');
                        // Optional: set a placeholder or style
                        img.style.border = '1px dashed var(--vscode-descriptionForeground)';
                        img.style.padding = '10px';
                        img.setAttribute('alt', '[Image Blocked]');
                        hasBlockedImages = true;
                    }
                });
                
                bodyContent = '<div id="htmlBody">' + doc.body.innerHTML + '</div>';
            } else if (msg.text) {
                bodyContent = '<pre>' + escapeHtml(msg.text) + '</pre>';
            } else {
                bodyContent = '<p style="color: var(--vscode-descriptionForeground)">No content available.</p>';
            }

            if (hasBlockedImages) {
                html += '<div class="images-blocked-warning" id="imagesBlockedWarning">';
                html += '<span>External images were blocked to protect your privacy.</span>';
                html += '<button id="btnShowImages">Show Images</button>';
                html += '</div>';
            }

            html += bodyContent;
            html += '</div>';

            // Reply editor (hidden initially)
            html += '<div class="reply-section hidden" id="replySection">';
            html += '<div class="reply-header" id="replyTitle">Reply</div>';
            html += '<div class="reply-toolbar">';
            html += '<button class="format-btn" data-cmd="bold" title="Bold"><b>B</b></button>';
            html += '<button class="format-btn" data-cmd="italic" title="Italic"><i>I</i></button>';
            html += '<button class="format-btn" data-cmd="underline" title="Underline"><u>U</u></button>';
            html += '<button class="format-btn" data-cmd="insertUnorderedList" title="Bullet List">• List</button>';
            html += '<button class="format-btn" data-cmd="insertOrderedList" title="Numbered List">1. List</button>';
            html += '</div>';
            html += '<div class="reply-editor" contenteditable="true" id="replyEditor"></div>';
            html += '<div class="reply-actions"><button class="btn-send" id="btnSendReply">Send</button></div>';
            html += '</div>';

            contentEl.innerHTML = html;

            if (hasBlockedImages) {
                document.getElementById('btnShowImages').addEventListener('click', () => {
                   const images = document.querySelectorAll('img[data-original-src]');
                   console.log('Found ' + images.length + ' blocked images to restore.');
                   
                   images.forEach(img => {
                       const original = img.getAttribute('data-original-src');
                       console.log('Restoring image: ' + original);
                       img.setAttribute('src', original);
                       img.removeAttribute('data-original-src');
                       img.style.border = '';
                       img.style.padding = '';
                   });
                   document.getElementById('imagesBlockedWarning').remove();
                });
            }

            // Format buttons
            document.querySelectorAll('.format-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.execCommand(btn.dataset.cmd, false, null);
                    document.getElementById('replyEditor').focus();
                });
            });
        }

        function showReplyEditor(mode) {
            const section = document.getElementById('replySection');
            const title = document.getElementById('replyTitle');
            if (section) {
                section.classList.remove('hidden');
                const labels = { reply: 'Reply', replyAll: 'Reply All', forward: 'Forward' };
                title.textContent = labels[mode] || 'Reply';
                document.getElementById('replyEditor').focus();
                section.scrollIntoView({ behavior: 'smooth' });
            }
        }

        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'loading':
                    contentEl.innerHTML = '<div class="loading">Loading message...</div>';
                    break;
                case 'message':
                    renderMessage(msg.message);
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
        const key = `${this.accountId}:${this.folderPath}:${this.uid}`;
        MessageDetailPanel.panels.delete(key);
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

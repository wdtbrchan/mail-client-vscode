import * as vscode from 'vscode';
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

            // Mark as seen if not already
            if (!message.seen) {
                await service.markMessageSeen(this.folderPath, this.uid);
                // Refresh to update unread counts
                MessageListPanel.refreshFolder(this.accountId, this.folderPath);
                this.explorerProvider.refresh();
            }
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
            case 'downloadAttachment':
                this.downloadAttachment(message.filename);
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

    async downloadAttachment(filename: string): Promise<void> {
        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(filename),
                saveLabel: 'Download'
            });

            if (!uri) {
                return;
            }

            vscode.window.showInformationMessage(`Downloading ${filename}...`);

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
            `<button class="action-btn" id="btnCustom_${i}" title="Move to ${cf.name}">📂 ${cf.name}</button>`
        ).join('');

        const sharedStyles = getSharedStyles(nonce);
        const sharedScripts = getSharedScripts(nonce, locale);

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
        }

        ${sharedStyles}

        /* Action toolbar */
        .action-bar {
            display: flex;
            gap: 8px;
            padding: 10px 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editorWidget-background);
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
        .action-btn svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }
        .action-btn.icon-only {
            padding: 6px;
            width: 32px;
            height: 32px;
            justify-content: center;
        }
        .action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .action-btn.icon-only:hover {
            background-color: var(--vscode-button-hoverBackground);
            color: var(--vscode-button-foreground);
            transform: scale(1.05);
        }
        .action-btn.danger {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-errorForeground);
        }
        .action-btn.danger:hover {
            opacity: 0.85;
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
    <div id="messageHeaders"></div>

    <div class="action-bar hidden" id="actionBar">
        <button class="action-btn" id="btnArchive" title="Archive">📂 Archive</button>
        <button class="action-btn" id="btnSpam" title="Mark as Spam">⛔ Spam</button>
        <button class="action-btn" id="btnNewsletters" title="Move to Newsletters">📰 News</button>
        <button class="action-btn" id="btnTrash" title="Move to Trash">🗑 Trash</button>
        <button class="action-btn danger hidden" id="btnDelete" title="Delete Permanently">❌ Delete</button>
        ${customButtonsHtml}
        <div style="flex: 1;"></div>
        <button class="action-btn icon-only" id="btnForward" title="Forward"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6L15 12L9 18"></path></svg></button>
        <button class="action-btn icon-only" id="btnReply" title="Reply"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6L9 12L15 18"></path></svg></button>
        <button class="action-btn icon-only" id="btnReplyAll" title="Reply All"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6L11 12L17 18"></path><path d="M10 6L4 12L10 18"></path></svg></button>
    </div>

    <div id="messageBody"></div>

    <div id="loadingIndicator" class="loading">Loading message...</div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        ${sharedScripts}
        
        const customFolders = ${JSON.stringify(customFolders)};
        console.log('Using locale:', userLocale);
        const headersEl = document.getElementById('messageHeaders');
        const bodyEl = document.getElementById('messageBody');
        const actionBar = document.getElementById('actionBar');
        const loadingEl = document.getElementById('loadingIndicator');
        let currentMessage = null;

        document.getElementById('btnReply').addEventListener('click', () => {
            vscode.postMessage({ type: 'reply' });
        });
        document.getElementById('btnReplyAll').addEventListener('click', () => {
            vscode.postMessage({ type: 'replyAll' });
        });
        document.getElementById('btnForward').addEventListener('click', () => {
            vscode.postMessage({ type: 'forward' });
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
                renderMessageView(msg.message);

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

        function renderMessageView(msg, showImages = false) {
             currentMessage = msg;
             loadingEl.classList.add('hidden');
             
             // Render everything into bodyEl (which is in the DOM, so getElementById works)
             renderMessage(bodyEl, msg, showImages, '_main');
             
             // Extract headers + attachments from bodyEl and move to headersEl
             headersEl.innerHTML = '';
             const headers = bodyEl.querySelector('.message-headers');
             const attachments = bodyEl.querySelector('.attachments');
             if (headers) headersEl.appendChild(headers);
             if (attachments) headersEl.appendChild(attachments);
             
             // Show action bar
             actionBar.classList.remove('hidden');
             
            // Re-bind listener for show images
              bodyEl.addEventListener('requestShowImages', (e) => {
                const message = e.detail.message;
                renderMessageView(message, true);
              });

            // Attachment buttons
            document.querySelectorAll('.attachment-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                   const filename = decodeURIComponent(btn.dataset.filename);
                   downloadAttachment(filename);
                });
            });
        }


        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'loading':
                    headersEl.innerHTML = '';
                    bodyEl.innerHTML = '';
                    actionBar.classList.add('hidden');
                    loadingEl.classList.remove('hidden');
                    loadingEl.textContent = 'Loading message...';
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

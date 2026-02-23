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
            case 'print':
                this.printHtml(message.html);
                break;
            case 'back':
                this.dispose();
                break;
        }
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
            vscode.window.showErrorMessage(`Failed to open print dialog: ${errorMsg}`);
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
        }

        ${sharedStyles}

        /* Action toolbar */
        .action-bar {
            display: flex;
            padding: 0;
            border-bottom: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editorWidget-background);
            height: 36px;
        }
        .action-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 0 16px;
            border: none;
            border-right: 1px solid var(--vscode-widget-border);
            border-radius: 0;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-family: inherit;
            font-size: 0.9em;
            height: 100%;
        }
        .action-btn svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
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
    </style>
</head>
<body>
    <div id="messageHeaders"></div>

    <div class="action-bar ${this.isEmbedded ? '' : 'hidden'}" id="actionBar">
        ${this.isEmbedded ? '<button class="action-btn" id="btnBack" title="Back to List"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back</button>' : ''}
        <div id="messageButtons" class="hidden" style="display: contents;">
            <button class="action-btn" id="btnArchive" title="Archive">📂 Archive</button>
            <button class="action-btn" id="btnSpam" title="Mark as Spam">⛔ Spam</button>
            <button class="action-btn" id="btnNewsletters" title="Move to Newsletters">📰 News</button>
            <button class="action-btn" id="btnTrash" title="Move to Trash">🗑 Trash</button>
            <button class="action-btn danger hidden" id="btnDelete" title="Delete Permanently">❌ Delete</button>
            ${customButtonsHtml}
            <div style="flex: 1;"></div>
            <button class="action-btn icon-only" id="btnPrint" title="Print"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg></button>
            <button class="action-btn icon-only" id="btnForward" title="Forward"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6L15 12L9 18"></path></svg></button>
            <button class="action-btn icon-only" id="btnReply" title="Reply"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6L9 12L15 18"></path></svg></button>
            <button class="action-btn icon-only" id="btnReplyAll" title="Reply All"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6L11 12L17 18"></path><path d="M10 6L4 12L10 18"></path></svg></button>
        </div>
    </div>

    <div id="messageBody"></div>

    <div id="loadingIndicator" class="loading">Loading message...</div>

    <div id="printOverlay" class="hidden">
        <div class="print-toolbar">
            <span style="color: var(--vscode-descriptionForeground); font-size: 13px; margin-right: auto; padding-left: 8px;">
                The preview will open in your default web browser for printing.
            </span>
            <button id="btnClosePrint" style="margin-right: 8px;">Close</button>
            <button id="btnConfirmPrint"><svg viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> PRINT</button>
        </div>
        <iframe id="printIframe" sandbox="allow-same-origin allow-scripts allow-popups allow-modals"></iframe>
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
             renderMessage(bodyEl, msg, showImages, '_main');
             
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
                case 'loading':
                    headersEl.innerHTML = '';
                    bodyEl.innerHTML = '';
                    if (!isEmbedded) {
                        actionBar.classList.add('hidden');
                    }
                    const mb = document.getElementById('messageButtons');
                    if (mb) mb.classList.add('hidden');
                    
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

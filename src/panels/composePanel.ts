import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { marked } from 'marked';
import { AccountManager } from '../services/accountManager';
import { SmtpService } from '../services/smtpService';
import { ImapService } from '../services/imapService';
import { IMailAccount } from '../types/account';
const MailComposer = require('nodemailer/lib/mail-composer');
import { IMailMessageDetail } from '../types/message';
import { getSharedStyles, getSharedScripts } from './utils/webviewContent';

/**
 * Compose mode: new message, reply, reply-all, or forward.
 */
export type ComposeMode = 'compose' | 'reply' | 'replyAll' | 'forward';

export interface ComposeOptions {
    /** Account to send from */
    account: IMailAccount;
    /** Compose mode */
    mode: ComposeMode;
    /** Original message (for reply/forward) */
    originalMessage?: IMailMessageDetail;
}

/**
 * Webview panel for composing an email.
 * Shows To/Cc/Bcc/Subject form fields and a live HTML preview
 * of the markdown file being edited in a VS Code editor alongside.
 */
export class ComposePanel {
    public static readonly viewType = 'mailClient.compose';
    private static instance: ComposePanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly tempFile: string;
    private disposables: vscode.Disposable[] = [];
    private currentMarkdown = '';
    private attachments: string[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        tempFile: string,
        private readonly accountManager: AccountManager,
        private readonly options: ComposeOptions,
    ) {
        this.panel = panel;
        this.tempFile = tempFile;

        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables,
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Listen for changes in the markdown editor
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.uri.fsPath.toLowerCase() === this.tempFile.toLowerCase()) {
                    this.currentMarkdown = e.document.getText();
                    this.updatePreview();
                }
            }),
        );

        // Initialize content
        try {
            this.currentMarkdown = fs.readFileSync(this.tempFile, 'utf8');
        } catch {
            this.currentMarkdown = '';
        }

        // Set initial content
        this.panel.webview.html = this.getHtmlContent();

        // Update preview initially (after short delay to ensure scripts loaded)
        setTimeout(() => this.updatePreview(), 500);

        // Pre-fill fields for reply/forward
        if (options.mode !== 'compose' && options.originalMessage) {
            this.sendPrefill();
        }
    }

    /**
     * Opens the compose panel alongside a temp markdown editor.
     */
    static async open(
        accountManager: AccountManager,
        options: ComposeOptions,
    ): Promise<ComposePanel> {
        // Close existing compose panel
        if (ComposePanel.instance) {
            ComposePanel.instance.panel.dispose();
        }

        // Create temp directory and file
        const tmpDir = path.join(os.tmpdir(), 'mail-client-compose');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        const tempFile = path.join(tmpDir, `compose-${Date.now()}.md`);

        // Write initial content
        let initialContent = '';
        if (options.mode === 'forward' && options.originalMessage) {
            initialContent = '\n\n';
        }
        fs.writeFileSync(tempFile, initialContent, 'utf8');

        // Open the markdown file in the editor (left column)
        const doc = await vscode.workspace.openTextDocument(tempFile);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

        // Create the preview webview panel (right column)
        const title = ComposePanel.getPanelTitle(options);
        const panel = vscode.window.createWebviewPanel(
            ComposePanel.viewType,
            title,
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        const instance = new ComposePanel(panel, tempFile, accountManager, options);
        ComposePanel.instance = instance;
        return instance;
    }

    private static getPanelTitle(options: ComposeOptions): string {
        switch (options.mode) {
            case 'reply': return '↩ Reply';
            case 'replyAll': return '↩↩ Reply All';
            case 'forward': return '↪ Forward';
            default: return '✉ New Message';
        }
    }

    private sendPrefill(): void {
        const msg = this.options.originalMessage!;
        const mode = this.options.mode;

        let to = '';
        let cc = '';
        let subject = msg.subject || '';

        if (mode === 'reply') {
            to = msg.from.address;
            subject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
        } else if (mode === 'replyAll') {
            to = msg.from.address;
            const allTo = msg.to
                .filter(a => a.address !== this.options.account.username)
                .map(a => a.address);
            if (allTo.length > 0) {
                to += ', ' + allTo.join(', ');
            }
            cc = (msg.cc || []).map(a => a.address).join(', ');
            subject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
        } else if (mode === 'forward') {
            subject = subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;
        }

        this.panel.webview.postMessage({
            type: 'prefill',
            to,
            cc,
            subject,
        });

        // Also send original message payload for display
        if (this.options.originalMessage) {
             const om = this.options.originalMessage;
             this.panel.webview.postMessage({
                type: 'originalMessage',
                message: {
                    ...om,
                    date: om.date.toISOString(),
                    fromDisplay: om.from.name
                        ? `${om.from.name} <${om.from.address}>`
                        : om.from.address,
                    toDisplay: om.to.map(t =>
                        t.name ? `${t.name} <${t.address}>` : t.address
                    ).join(', '),
                    ccDisplay: om.cc?.map(c =>
                        c.name ? `${c.name} <${c.address}>` : c.address
                    ).join(', '),
                }
            });
        }
    }

    private async updatePreview(): Promise<void> {
        const html = await marked.parse(this.currentMarkdown);
        this.panel.webview.postMessage({
            type: 'preview',
            html,
        });
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'send':
                await this.sendEmail(message);
                break;
            case 'discard':
                this.panel.dispose();
                break;
            case 'pickAttachments':
                this.pickAttachments();
                break;
            case 'removeAttachment':
                this.removeAttachment(message.path);
                break;
        }
    }

    private async pickAttachments(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            openLabel: 'Attach',
            title: 'Attach Files'
        });

        if (uris && uris.length > 0) {
            for (const uri of uris) {
                if (!this.attachments.includes(uri.fsPath)) {
                    this.attachments.push(uri.fsPath);
                }
            }
            this.updateAttachments();
        }
    }

    private removeAttachment(pathToRemove: string): void {
        this.attachments = this.attachments.filter(p => p !== pathToRemove);
        this.updateAttachments();
    }

    private updateAttachments(): void {
        this.panel.webview.postMessage({
            type: 'updateAttachments',
            attachments: this.attachments.map(p => ({
                path: p,
                name: path.basename(p)
            }))
        });
    }

    private async sendEmail(message: any): Promise<void> {
        const { to, cc, bcc, subject } = message;

        if (!to || !to.trim()) {
            this.panel.webview.postMessage({ type: 'error', message: 'Recipient (To) is required.' });
            return;
        }
        if (!subject || !subject.trim()) {
            this.panel.webview.postMessage({ type: 'error', message: 'Subject is required.' });
            return;
        }

        try {
            this.panel.webview.postMessage({ type: 'sending' });

            const account = this.options.account;
            const smtpPassword = await this.accountManager.getSmtpPassword(account.id);
            if (!smtpPassword) {
                // Fallback to IMAP password
                const imapPassword = await this.accountManager.getPassword(account.id);
                if (!imapPassword) {
                    throw new Error('No SMTP password found for this account.');
                }
                await this.doSend(account, imapPassword, to, cc, bcc, subject);
            } else {
                await this.doSend(account, smtpPassword, to, cc, bcc, subject);
            }

            vscode.window.showInformationMessage('Message sent successfully.');
            this.panel.dispose();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to send message';
            this.panel.webview.postMessage({ type: 'error', message: errorMsg });
            vscode.window.showErrorMessage(`Send failed: ${errorMsg}`);
        }
    }

    private async doSend(
        account: IMailAccount,
        password: string,
        to: string,
        cc: string,
        bcc: string,
        subject: string,
    ): Promise<void> {
        // Convert markdown body to HTML
        let bodyHtml = await marked.parse(this.currentMarkdown);

        // For reply/forward, append quoted original message
        if (this.options.mode !== 'compose' && this.options.originalMessage) {
            const orig = this.options.originalMessage;
            const quotedHeader = `<p style="color:#666;border-left:3px solid #ccc;padding-left:12px;margin-top:20px;">` +
                `On ${orig.date.toLocaleDateString()} ${orig.date.toLocaleTimeString()}, ` +
                `${orig.from.name || orig.from.address} wrote:</p>`;
            const quotedBody = orig.html || `<pre>${this.escapeHtml(orig.text || '')}</pre>`;
            bodyHtml += `\n<blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555;">\n${quotedHeader}\n${quotedBody}\n</blockquote>`;
        }

        const fromAddress = account.smtpUsername || account.username;
        const fromDisplay = account.name ? `${account.name} <${fromAddress}>` : fromAddress;

        // 1. Generate Raw Email
        const mailOptions = {
            from: fromDisplay,
            to,
            cc: cc || undefined,
            bcc: bcc || undefined,
            subject,
            html: bodyHtml,
            text: this.currentMarkdown,
            attachments: this.attachments.map(p => ({
                path: p,
                filename: path.basename(p)
            }))
        };
        const composer = new MailComposer(mailOptions);
        const messageBuffer = await composer.compile().build();

        // 2. Send via SMTP
        await SmtpService.sendMail(account, password, {
            ...mailOptions,
            raw: messageBuffer
        });

        // 3. Append to Sent Folder (IMAP)
        try {
            const imapService = new ImapService();
            // We need IMAP password (which might be different from SMTP password provided as 'password' arg)
            const imapPassword = await this.accountManager.getPassword(account.id);
            if (imapPassword) {
                await imapService.connect(account, imapPassword);
                const sentFolder = account.sentFolder || 'Sent';
                // Try to append. If folder doesn't exist, this might fail.
                // We'll catch errors to not block the success message.
                await imapService.appendMessage(sentFolder, messageBuffer, ['\\Seen']);
                await imapService.disconnect();
            }
        } catch (error) {
            console.error('Failed to save to Sent folder:', error);
            // Optionally notify user, but requirement says "if not exists, do nothing" (implies silent fail for that part)
        }
    }

    private escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private getHtmlContent(): string {
        const nonce = getNonce();
        const config = vscode.workspace.getConfiguration('mailClient');
        const configLocale = config.get<string>('locale');
        const locale = configLocale || vscode.env.language;

        const sharedStyles = getSharedStyles(nonce);
        const sharedScripts = getSharedScripts(nonce, locale);

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src * data:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Compose</title>
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
        }

        ${sharedStyles}

        /* Form fields */
        .compose-form {
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editorWidget-background);
            flex-shrink: 0;
        }
        .form-row {
            display: grid;
            grid-template-columns: 70px 1fr;
            align-items: center;
            margin-bottom: 6px;
        }
        .form-row label {
            color: var(--vscode-descriptionForeground);
            font-weight: 500;
            font-size: 0.9em;
        }
        .form-row input {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 5px 8px;
            font-family: inherit;
            font-size: inherit;
            outline: none;
        }
        .form-row input:focus {
            border-color: var(--vscode-focusBorder);
        }
        .toggle-cc {
            font-size: 0.85em;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            margin-left: 72px;
            margin-bottom: 6px;
            background: none;
            border: none;
            font-family: inherit;
            font-size: inherit;
        }
        .toggle-cc:hover {
            text-decoration: underline;
        }
        .hidden { display: none; }

        /* Account info */
        .account-info {
            padding: 6px 16px;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-widget-border);
            flex-shrink: 0;
        }

        /* Preview area */
        .preview-area {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        .preview-label {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .preview-content {
            line-height: 1.6;
            min-height: 100px;
        }
        .preview-content h1 { font-size: 1.5em; margin: 12px 0 8px; }
        .preview-content h2 { font-size: 1.3em; margin: 10px 0 6px; }
        .preview-content h3 { font-size: 1.1em; margin: 8px 0 4px; }
        .preview-content p { margin: 6px 0; }
        .preview-content ul, .preview-content ol { margin: 6px 0; padding-left: 24px; }
        .preview-content code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 5px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }
        .preview-content pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
        }
        .preview-content pre code {
            background: none;
            padding: 0;
        }
        .preview-content blockquote {
            border-left: 3px solid var(--vscode-editorWidget-border);
            padding-left: 12px;
            color: var(--vscode-descriptionForeground);
            margin: 8px 0;
        }
        .preview-content a {
            color: var(--vscode-textLink-foreground);
        }
        .preview-content img {
            max-width: 100%;
        }
        .preview-empty {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        /* Action bar */
        .action-bar {
            display: flex;
            gap: 8px;
            padding: 10px 16px;
            border-top: 1px solid var(--vscode-widget-border);
            background: var(--vscode-editorWidget-background);
            flex-shrink: 0;
        }
        .btn-send {
            padding: 8px 24px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            font-family: inherit;
            font-size: inherit;
        }
        .btn-send:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-send:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .btn-discard {
            padding: 8px 16px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
            font-size: inherit;
        }
        .btn-discard:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .status-text {
            flex: 1;
            display: flex;
            align-items: center;
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }
        .error-text {
            color: var(--vscode-errorForeground);
        }
        .btn-small {
            padding: 4px 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .btn-small:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .attachment-list {
            margin-top: 6px;
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .attachment-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            background: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 3px;
            font-size: 0.85em;
        }
        .remove-att {
            cursor: pointer;
            color: var(--vscode-errorForeground);
            font-weight: bold;
            padding: 0 4px;
        }
        .remove-att:hover {
            background: var(--vscode-toolbar-hoverBackground);
            border-radius: 2px;
        }
    </style>
</head>
<body>
    <div class="account-info">
        From: <strong>${this.escapeHtml(this.options.account.name)}</strong>
        (${this.escapeHtml(this.options.account.smtpUsername || this.options.account.username)})
    </div>

    <div class="compose-form">
        <div class="form-row">
            <label for="fieldTo">To:</label>
            <input type="text" id="fieldTo" placeholder="recipient@example.com" />
        </div>
        <button class="toggle-cc" id="toggleCc">Show Cc/Bcc</button>
        <div class="form-row hidden" id="rowCc">
            <label for="fieldCc">Cc:</label>
            <input type="text" id="fieldCc" placeholder="cc@example.com" />
        </div>
        <div class="form-row hidden" id="rowBcc">
            <label for="fieldBcc">Bcc:</label>
            <input type="text" id="fieldBcc" placeholder="bcc@example.com" />
        </div>
        <div class="form-row">
            <label for="fieldSubject">Subject:</label>
            <input type="text" id="fieldSubject" placeholder="Subject" />
        </div>

        <div class="form-row" style="align-items:start">
             <label>Files:</label>
             <div>
                <button id="btnAddAttachment" class="btn-small">📎 Attach Files</button>
                <div id="attachmentList" class="attachment-list"></div>
             </div>
        </div>
    </div>

    <div class="preview-area">
        <div class="preview-label">Preview</div>
        <div class="preview-content" id="previewContent">
            <p class="preview-empty">Start typing in the editor to see a preview…</p>
        </div>
        
        <div id="original-message-container" class="quoted-message-container hidden">
            <div class="quoted-message-title">Original Message</div>
            <div id="original-message-content"></div>
        </div>
    </div>

    <div class="action-bar">
        <button class="btn-send" id="btnSend">✉ Send</button>
        <button class="btn-discard" id="btnDiscard">✕ Discard</button>
        <span class="status-text" id="statusText"></span>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        ${sharedScripts}

        const fieldTo = document.getElementById('fieldTo');
        const fieldCc = document.getElementById('fieldCc');
        const fieldBcc = document.getElementById('fieldBcc');
        const fieldSubject = document.getElementById('fieldSubject');
        const previewContent = document.getElementById('previewContent');
        const statusText = document.getElementById('statusText');
        const btnSend = document.getElementById('btnSend');
        const attachmentList = document.getElementById('attachmentList');
        const originalMessageContainer = document.getElementById('original-message-container');
        const originalMessageContent = document.getElementById('original-message-content');

        // Attachments
        document.getElementById('btnAddAttachment').addEventListener('click', () => {
            vscode.postMessage({ type: 'pickAttachments' });
        });

        // Toggle Cc/Bcc
        document.getElementById('toggleCc').addEventListener('click', () => {
            const rowCc = document.getElementById('rowCc');
            const rowBcc = document.getElementById('rowBcc');
            const btn = document.getElementById('toggleCc');
            const isHidden = rowCc.classList.contains('hidden');
            rowCc.classList.toggle('hidden');
            rowBcc.classList.toggle('hidden');
            btn.textContent = isHidden ? 'Hide Cc/Bcc' : 'Show Cc/Bcc';
        });

        // Send
        document.getElementById('btnSend').addEventListener('click', () => {
            vscode.postMessage({
                type: 'send',
                to: fieldTo.value,
                cc: fieldCc.value,
                bcc: fieldBcc.value,
                subject: fieldSubject.value,
            });
        });

        // Discard
        document.getElementById('btnDiscard').addEventListener('click', () => {
            vscode.postMessage({ type: 'discard' });
        });

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'preview':
                    if (msg.html && msg.html.trim()) {
                        previewContent.innerHTML = msg.html;
                    } else {
                        previewContent.innerHTML = '<p class="preview-empty">Start typing in the editor to see a preview…</p>';
                    }
                    break;
                case 'prefill':
                    if (msg.to) fieldTo.value = msg.to;
                    if (msg.cc) {
                        fieldCc.value = msg.cc;
                        document.getElementById('rowCc').classList.remove('hidden');
                        document.getElementById('rowBcc').classList.remove('hidden');
                        document.getElementById('toggleCc').textContent = 'Hide Cc/Bcc';
                    }
                    if (msg.subject) fieldSubject.value = msg.subject;
                    break;
                case 'originalMessage':
                    if (msg.message) {
                        originalMessageContainer.classList.remove('hidden');
                        // Use the shared renderMessage function
                        // We render into #original-message-content
                        // Pass a unique suffix for potential ID collisions if we had multiple
                        renderMessage(originalMessageContent, msg.message, false, '_orig');
                        
                        originalMessageContent.addEventListener('requestShowImages', (e) => {
                            const message = e.detail.message;
                            renderMessage(originalMessageContent, message, true, '_orig');
                        });
                    }
                    break;
                case 'sending':
                    btnSend.disabled = true;
                    statusText.textContent = 'Sending…';
                    statusText.classList.remove('error-text');
                    break;
                case 'error':
                    btnSend.disabled = false;
                    statusText.textContent = msg.message;
                    statusText.classList.add('error-text');
                    break;
                case 'updateAttachments':
                    renderAttachments(msg.attachments);
                    break;
            }
        });

        function renderAttachments(list) {
            attachmentList.innerHTML = '';
            list.forEach(item => {
                const div = document.createElement('div');
                div.className = 'attachment-item';
                div.innerHTML = '<span>' + item.name + '</span>';
                const removeBtn = document.createElement('span');
                removeBtn.className = 'remove-att';
                removeBtn.innerHTML = '×';
                removeBtn.title = 'Remove';
                removeBtn.onclick = () => {
                   vscode.postMessage({ type: 'removeAttachment', path: item.path });
                };
                div.appendChild(removeBtn);
                attachmentList.appendChild(div);
            });
        }
    </script>
</body>
</html>`;
    }

    private dispose(): void {
        ComposePanel.instance = undefined;

        // Clean up temp file
        try {
            if (fs.existsSync(this.tempFile)) {
                // Close the editor tab showing this file
                for (const tabGroup of vscode.window.tabGroups.all) {
                    for (const tab of tabGroup.tabs) {
                        if (tab.input instanceof vscode.TabInputText &&
                            tab.input.uri.fsPath === this.tempFile) {
                            vscode.window.tabGroups.close(tab);
                        }
                    }
                }
                fs.unlinkSync(this.tempFile);
            }
        } catch {
            // Ignore cleanup errors
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

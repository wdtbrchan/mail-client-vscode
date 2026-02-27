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
import { MessageListPanel } from './messageListPanel';
import { MessageDetailPanel } from './messageDetailPanel';

// @ts-ignore
import composeHtml from './views/compose/compose.html';
// @ts-ignore
import composeCss from './views/compose/compose.css';
// @ts-ignore
import composeJs from './views/compose/compose.js';

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
    /** Original folder path for archive action */
    originalFolderPath?: string;
    /** Explorer provider to reuse existing IMAP connection */
    explorerProvider?: import('../providers/mailExplorerProvider').MailExplorerProvider;
    /** Whether to show external images in the original quoted text */
    showImages?: boolean;
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
    private readonly isWysiwyg: boolean;
    private disposables: vscode.Disposable[] = [];
    private currentMarkdown = '';
    private wysiwygHtml = '';
    private attachments: string[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        tempFile: string,
        isWysiwyg: boolean,
        private readonly accountManager: AccountManager,
        private readonly options: ComposeOptions,
    ) {
        this.panel = panel;
        this.tempFile = tempFile;
        this.isWysiwyg = isWysiwyg;

        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables,
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Listen for changes in the markdown editor (only in MD mode)
        if (!isWysiwyg && tempFile) {
            this.disposables.push(
                vscode.workspace.onDidChangeTextDocument(e => {
                    if (e.document.uri.fsPath.toLowerCase() === this.tempFile.toLowerCase()) {
                        this.currentMarkdown = e.document.getText();
                        this.updatePreview();
                    }
                }),
            );
        }

        // Initialize content (MD mode only)
        if (!isWysiwyg && tempFile) {
            try {
                this.currentMarkdown = fs.readFileSync(this.tempFile, 'utf8');
            } catch {
                this.currentMarkdown = '';
            }
        }

        // Set initial content
        this.panel.webview.html = this.getHtmlContent();

        // Update preview initially (after short delay to ensure scripts loaded) - MD mode only
        if (!isWysiwyg) {
            setTimeout(() => this.updatePreview(), 500);
        }

        // Pre-fill fields for reply/forward
        if (options.mode !== 'compose' && options.originalMessage) {
            this.sendPrefill();
        }
    }

    /**
     * Opens the compose panel in WYSIWYG or Markdown mode based on settings.
     */
    static async open(
        accountManager: AccountManager,
        options: ComposeOptions,
    ): Promise<ComposePanel> {
        // Close existing compose panel
        if (ComposePanel.instance) {
            ComposePanel.instance.panel.dispose();
        }

        const config = vscode.workspace.getConfiguration('mailClient');
        const composeMode = config.get<string>('composeMode', 'wysiwyg');
        const isWysiwyg = composeMode === 'wysiwyg';

        let tempFile = '';

        if (!isWysiwyg) {
            // Markdown mode: create temp file and open in editor
            const tmpDir = path.join(os.tmpdir(), 'mail-client-compose');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            tempFile = path.join(tmpDir, `compose-${Date.now()}.md`);

            let initialContent = '';
            if (!isWysiwyg && options.account.markdownSignature) {
                initialContent = '\n\n' + options.account.markdownSignature;
            } else if (options.account.signature) {
                initialContent = '\n\n' + options.account.signature;
            }
            if (options.mode === 'forward' && options.originalMessage) {
                initialContent = '\n\n' + initialContent;
            }
            fs.writeFileSync(tempFile, initialContent, 'utf8');

            const doc = await vscode.workspace.openTextDocument(tempFile);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            
            // Focus at the top of the message
            const pos = new vscode.Position(0, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
        }

        // Create the compose webview panel
        const title = ComposePanel.getPanelTitle(options);
        const panel = vscode.window.createWebviewPanel(
            ComposePanel.viewType,
            title,
            isWysiwyg ? vscode.ViewColumn.One : { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        const instance = new ComposePanel(panel, tempFile, isWysiwyg, accountManager, options);
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
             
             const config = vscode.workspace.getConfiguration('mailClient');
             const whitelist: string[] = config.get('imageWhitelist') || [];
             const isWhitelisted = whitelist.includes(om.from.address);
             
             const account = this.options.account;
             const folderSettings = {
                spam: account.spamFolder || 'Spam',
             };
             const isSpam = this.options.originalFolderPath === folderSettings.spam;

             this.panel.webview.postMessage({
                type: 'originalMessage',
                showImages: !!this.options.showImages,
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
                    isWhitelisted,
                    isSpam,
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
            case 'sendAndArchive':
                if (this.isWysiwyg) {
                    this.wysiwygHtml = message.wysiwygHtml || '';
                }
                await this.sendEmail(message, message.type === 'sendAndArchive');
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
            case 'switchToMarkdown':
                await this.switchToMarkdownMode();
                break;
            case 'switchToWysiwyg':
                await this.switchToWysiwygMode();
                break;
            case 'openExternal':
                vscode.env.openExternal(vscode.Uri.parse(message.url));
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

    private async sendEmail(message: any, archiveOriginal: boolean = false): Promise<void> {
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
                await this.doSend(account, imapPassword, to, cc, bcc, subject, archiveOriginal);
            } else {
                await this.doSend(account, smtpPassword, to, cc, bcc, subject, archiveOriginal);
            }

            vscode.window.showInformationMessage('Message sent.');
            this.panel.dispose();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to send message';
            this.panel.webview.postMessage({ type: 'error', message: errorMsg });
            vscode.window.showErrorMessage(`Send failed: ${errorMsg}`);
        }
    }

    /**
     * Switches from WYSIWYG to Markdown mode.
     * Updates the setting and reopens the compose panel.
     */
    private async switchToMarkdownMode(): Promise<void> {
        const config = vscode.workspace.getConfiguration('mailClient');
        await config.update('composeMode', 'markdown', vscode.ConfigurationTarget.Global);
        
        // Reopen with same options in markdown mode
        const options = this.options;
        this.panel.dispose();
        await ComposePanel.open(this.accountManager, options);
    }

    /**
     * Switches from Markdown to WYSIWYG mode.
     * Updates the setting and reopens the compose panel.
     */
    private async switchToWysiwygMode(): Promise<void> {
        const config = vscode.workspace.getConfiguration('mailClient');
        await config.update('composeMode', 'wysiwyg', vscode.ConfigurationTarget.Global);
        
        // Reopen with same options in WYSIWYG mode
        const options = this.options;
        this.panel.dispose();
        await ComposePanel.open(this.accountManager, options);
    }

    private async doSend(
        account: IMailAccount,
        password: string,
        to: string,
        cc: string,
        bcc: string,
        subject: string,
        archiveOriginal: boolean = false,
    ): Promise<void> {
        // Get body HTML based on mode
        let bodyHtml: string;
        if (this.isWysiwyg) {
            bodyHtml = this.wysiwygHtml;
        } else {
            bodyHtml = await marked.parse(this.currentMarkdown);
        }

        // For reply/forward, append quoted original message in both Markdown and WYSIWYG modes
        if (this.options.mode !== 'compose' && this.options.originalMessage) {
            const orig = this.options.originalMessage;
            const isForward = this.options.mode === 'forward';
            const separatorLabel = isForward ? 'Forwarded' : 'Original';
            const fromDisplay = orig.from.name
                ? `${orig.from.name} &lt;${orig.from.address}&gt;`
                : orig.from.address;
            const toDisplay = orig.to.map(t =>
                t.name ? `${t.name} &lt;${t.address}&gt;` : t.address
            ).join(', ');
            const dateStr = orig.date.toLocaleDateString() + ' ' + orig.date.toLocaleTimeString();
            const subjectStr = this.escapeHtml(orig.subject || '');

            const separator = `<p style="margin-top:20px;">---------- ${separatorLabel} ----------<br>` +
                `From: ${fromDisplay}<br>` +
                `To: ${toDisplay}<br>` +
                `Date: ${dateStr}<br>` +
                `Subject: ${subjectStr}</p>`;
            const quotedBody = orig.html || `<pre>${this.escapeHtml(orig.text || '')}</pre>`;
            bodyHtml += `\n${separator}\n<div>\n${quotedBody}\n</div>`;
        }

        const fromAddress = account.smtpUsername || account.username;
        const fromName = account.senderName || account.name;
        const fromDisplay = fromName ? `"${fromName.replace(/"/g, '\\"')}" <${fromAddress}>` : fromAddress;

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
                try {
                    let sentFolder = account.sentFolder;
                    if (!sentFolder) {
                        sentFolder = await imapService.getSentFolderPath();
                    }
                    if (!sentFolder) {
                        sentFolder = 'Sent';
                    }

                    try {
                        await imapService.appendMessage(sentFolder, messageBuffer, ['\\Seen']);
                        // Refresh the Sent folder if it's currently open
                        MessageListPanel.refreshFolder(account.id, sentFolder);
                    } catch (appendErr) {
                        console.error('Error saving to Sent folder:', appendErr);
                        vscode.window.showWarningMessage(`Sent, but failed to save to "${sentFolder}".`);
                    }

                    if (archiveOriginal && this.options.originalMessage && this.options.originalFolderPath) {
                        const archiveFolder = account.archiveFolder || 'Archive';
                        try {
                            const uid = this.options.originalMessage.uid;
                            if (this.options.originalFolderPath !== archiveFolder) {
                                if (this.options.explorerProvider) {
                                    const existingService = this.options.explorerProvider.getImapService(account.id);
                                    await existingService.moveMessage(this.options.originalFolderPath, uid, archiveFolder);
                                } else {
                                    await imapService.moveMessage(this.options.originalFolderPath, uid, archiveFolder);
                                }
                                MessageListPanel.refreshFolder(account.id, this.options.originalFolderPath);
                                MessageDetailPanel.handleExternalMove(account.id, this.options.originalFolderPath, uid);
                                vscode.window.showInformationMessage(`Original message moved to ${archiveFolder}`);
                            }
                        } catch (archiveErr) {
                             console.error('Failed to move original message to archive:', archiveErr);
                             vscode.window.showWarningMessage(`Sent, but failed to archive original message.`);
                        }
                    }
                } finally {
                    await imapService.disconnect();
                }
            }
        } catch (error) {
            console.error('Failed to connect to IMAP for saving to Sent folder:', error);
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

        const sig = this.options.account.signature || '';
        let initialWysiwygHtml = sig ? `<br><br><div class="signature">${sig}</div>` : '<br><br>';

        const senderName = this.escapeHtml(this.options.account.senderName || this.options.account.name);
        const senderEmail = this.escapeHtml(this.options.account.smtpUsername || this.options.account.username);

        const composeConfig = {
            isWysiwyg: this.isWysiwyg,
            mode: this.options.mode
        };

        return composeHtml
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace('{{SHARED_STYLES}}', sharedStyles)
            .replace('{{CSS_INJECT}}', composeCss)
            .replace('{{MODE}}', this.options.mode)
            .replace('{{EDITOR_MODE}}', this.isWysiwyg ? 'wysiwyg' : 'markdown')
            .replace('{{SENDER_NAME}}', senderName)
            .replace('{{SENDER_EMAIL}}', senderEmail)
            .replace('{{INITIAL_WYSIWYG_HTML}}', initialWysiwygHtml)
            .replace('{{COMPOSE_CONFIG}}', JSON.stringify(composeConfig))
            .replace('{{SHARED_SCRIPTS}}', sharedScripts)
            .replace('{{JS_INJECT}}', composeJs);
    }

    private dispose(): void {
        ComposePanel.instance = undefined;

        // Clean up temp file (MD mode only)
        if (this.tempFile) {
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

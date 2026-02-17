import { ImapFlow, MailboxObject } from 'imapflow';
import { IMailAccount } from '../types/account';
import { IMailFolder } from '../types/folder';
import { IMailMessage, IMailMessageDetail, IMailAddress, IMailAttachment } from '../types/message';

/**
 * Handles IMAP communication for a single mail account.
 * Wraps the imapflow library with typed interfaces.
 */
export class ImapService {
    private client: ImapFlow | null = null;
    private _connected = false;

    get connected(): boolean {
        return this._connected;
    }

    /**
     * Connects to the IMAP server using account credentials.
     */
    async connect(account: IMailAccount, password: string): Promise<void> {
        this.client = new ImapFlow({
            host: account.host,
            port: account.port,
            secure: account.secure,
            auth: {
                user: account.username,
                pass: password,
            },
            logger: false,
        });

        await this.client.connect();
        this._connected = true;
    }

    /**
     * Disconnects from the IMAP server.
     */
    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.logout();
            this.client = null;
            this._connected = false;
        }
    }

    /**
     * Lists all mailbox folders recursively.
     * Uses list() instead of listTree() because ImapFlow's getFolderTree()
     * casts status to boolean, losing actual unseen/messages counts.
     */
    async listFolders(): Promise<IMailFolder[]> {
        this.ensureConnected();
        const flatList = await this.client!.list({
            statusQuery: { messages: true, unseen: true },
        });
        return this.convertFlatToTree(flatList);
    }

    /**
     * Fetches message headers from a folder.
     * @param folderPath - IMAP folder path (e.g. "INBOX")
     * @param limit - Maximum number of messages to fetch
     * @param offset - Number of messages to skip (for pagination)
     */
    async getMessages(folderPath: string, limit = 50, offset = 0): Promise<IMailMessage[]> {
        this.ensureConnected();

        const lock = await this.client!.getMailboxLock(folderPath);
        try {
            const mailbox = this.client!.mailbox as MailboxObject;
            const total = mailbox.exists;

            if (total === 0) {
                return [];
            }

            // Calculate sequence range (newest first)
            const start = Math.max(1, total - offset - limit + 1);
            const end = Math.max(1, total - offset);
            const range = `${start}:${end}`;

            const messages: IMailMessage[] = [];

            for await (const msg of this.client!.fetch(range, {
                uid: true,
                envelope: true,
                flags: true,
                bodyStructure: true,
                size: true,
            })) {
                const envelope = msg.envelope;
                if (!envelope) {
                    continue;
                }
                messages.push({
                    uid: msg.uid,
                    date: envelope.date || new Date(),
                    subject: envelope.subject || '(no subject)',
                    from: this.convertAddress(envelope.from?.[0]),
                    to: (envelope.to || []).map((a: any) => this.convertAddress(a)),
                    cc: envelope.cc?.map((a: any) => this.convertAddress(a)),
                    hasAttachments: this.hasAttachments(msg.bodyStructure),
                    seen: msg.flags?.has('\\Seen') ?? false,
                    size: msg.size || 0,
                });
            }

            // Sort by date descending (newest first)
            messages.sort((a, b) => b.date.getTime() - a.date.getTime());
            return messages;
        } finally {
            lock.release();
        }
    }

    /**
     * Fetches a complete message including body content.
     * @param folderPath - IMAP folder path
     * @param uid - Message UID
     */
    async getMessage(folderPath: string, uid: number): Promise<IMailMessageDetail> {
        this.ensureConnected();

        const lock = await this.client!.getMailboxLock(folderPath);
        try {
            const msg = await this.client!.fetchOne(
                String(uid),
                {
                    uid: true,
                    envelope: true,
                    flags: true,
                    bodyStructure: true,
                    size: true,
                    source: true,
                },
                { uid: true }
            );

            if (!msg) {
                throw new Error(`Message UID ${uid} not found`);
            }

            const envelope = msg.envelope;
            if (!envelope) {
                throw new Error(`Failed to fetch envelope for UID ${uid}`);
            }

            // Download and parse the message source for body content
            const downloadResult = await this.client!.download(String(uid), undefined, { uid: true });
            let html: string | undefined;
            let text: string | undefined;
            const attachments: IMailAttachment[] = [];

            if (downloadResult) {
                const chunks: Buffer[] = [];
                for await (const chunk of downloadResult.content) {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                }
                const source = Buffer.concat(chunks).toString();

                // Simple extraction - in production, use mailparser
                html = this.extractHtmlBody(source);
                text = this.extractTextBody(source);
            }

            // Extract attachment info from body structure
            this.extractAttachments(msg.bodyStructure, attachments);

            return {
                uid: msg.uid,
                date: envelope.date || new Date(),
                subject: envelope.subject || '(no subject)',
                from: this.convertAddress(envelope.from?.[0]),
                to: (envelope.to || []).map((a: any) => this.convertAddress(a)),
                cc: envelope.cc?.map((a: any) => this.convertAddress(a)),
                hasAttachments: attachments.length > 0,
                seen: msg.flags?.has('\\Seen') ?? false,
                size: msg.size || 0,
                html,
                text,
                attachments,
            };
        } finally {
            lock.release();
        }
    }

    /**
     * Deletes a message by UID.
     * Flags the message as \Deleted and expunges it.
     * @param folderPath - IMAP folder path
     * @param uid - Message UID
     */
    async deleteMessage(folderPath: string, uid: number): Promise<void> {
        this.ensureConnected();

        const lock = await this.client!.getMailboxLock(folderPath);
        try {
            await this.client!.messageDelete(String(uid), { uid: true });
        } finally {
            lock.release();
        }
    }

    /**
     * Tests the connection to an IMAP server.
     * Returns true if successful, throws on failure.
     */
    static async testConnection(account: IMailAccount, password: string): Promise<boolean> {
        const client = new ImapFlow({
            host: account.host,
            port: account.port,
            secure: account.secure,
            auth: {
                user: account.username,
                pass: password,
            },
            logger: false,
        });

        try {
            await client.connect();
            await client.logout();
            return true;
        } catch (error) {
            throw error;
        }
    }

    // ---- Private helpers ----

    private ensureConnected(): void {
        if (!this.client || !this._connected) {
            throw new Error('Not connected to IMAP server');
        }
    }

    /**
     * Converts the flat folder list from list() into a tree structure.
     * Unlike listTree()/getFolderTree(), this preserves the status object.
     */
    private convertFlatToTree(flatList: any[]): IMailFolder[] {
        // Build a map of path -> IMailFolder
        const folderMap = new Map<string, IMailFolder>();
        const rootFolders: IMailFolder[] = [];

        // First pass: create all folder objects
        for (const entry of flatList) {
            const folder: IMailFolder = {
                path: entry.path,
                name: entry.name,
                delimiter: entry.delimiter || '/',
                specialUse: entry.specialUse,
                totalMessages: entry.status?.messages,
                unseenMessages: entry.status?.unseen,
            };
            folderMap.set(entry.path, folder);
        }

        // Second pass: build the tree
        for (const entry of flatList) {
            const folder = folderMap.get(entry.path)!;
            if (entry.parentPath) {
                const parent = folderMap.get(entry.parentPath);
                if (parent) {
                    if (!parent.children) {
                        parent.children = [];
                    }
                    parent.children.push(folder);
                    continue;
                }
            }
            rootFolders.push(folder);
        }

        return rootFolders;
    }

    private convertAddress(addr: any): IMailAddress {
        if (!addr) {
            return { address: 'unknown' };
        }
        return {
            name: addr.name || undefined,
            address: addr.address || 'unknown',
        };
    }

    private hasAttachments(bodyStructure: any): boolean {
        if (!bodyStructure) {
            return false;
        }
        if (bodyStructure.disposition === 'attachment') {
            return true;
        }
        if (bodyStructure.childNodes) {
            return bodyStructure.childNodes.some((child: any) => this.hasAttachments(child));
        }
        return false;
    }

    private extractAttachments(bodyStructure: any, attachments: IMailAttachment[]): void {
        if (!bodyStructure) {
            return;
        }
        if (bodyStructure.disposition === 'attachment') {
            attachments.push({
                filename: bodyStructure.dispositionParameters?.filename || 'unnamed',
                contentType: bodyStructure.type || 'application/octet-stream',
                size: bodyStructure.size || 0,
            });
        }
        if (bodyStructure.childNodes) {
            for (const child of bodyStructure.childNodes) {
                this.extractAttachments(child, attachments);
            }
        }
    }

    private extractHtmlBody(source: string): string | undefined {
        // Basic HTML extraction from MIME source
        const htmlMatch = source.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\r?\n\.\r?\n|$)/i);
        return htmlMatch?.[1]?.trim();
    }

    private extractTextBody(source: string): string | undefined {
        // Basic plain text extraction from MIME source
        const textMatch = source.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\r?\n\.\r?\n|$)/i);
        return textMatch?.[1]?.trim();
    }
}

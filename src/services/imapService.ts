import { ImapFlow, MailboxObject } from 'imapflow';
import { simpleParser } from 'mailparser';
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
            const downloadResult = await this.client!.download(String(uid), undefined, { uid: true });
            
            if (!downloadResult) {
                throw new Error(`Failed to download message UID ${uid}`);
            }

            const chunks: Buffer[] = [];
            for await (const chunk of downloadResult.content) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const source = Buffer.concat(chunks);

            const flagsMsg = await this.client!.fetchOne(String(uid), { flags: true, uid: true }, { uid: true });
            const seen = (flagsMsg && typeof flagsMsg === 'object' && flagsMsg.flags && flagsMsg.flags.has('\\Seen')) || false;

            const parsed = await simpleParser(source);

            const mapAddresses = (field: any): IMailAddress[] => {
                if (!field) return [];
                if (field.value && Array.isArray(field.value)) {
                    return field.value.map((a: any) => ({ name: a.name, address: a.address || 'unknown' }));
                }
                if (Array.isArray(field)) {
                    return field.flatMap((f: any) => mapAddresses(f));
                }
                return [];
            };

            const from = parsed.from ? mapAddresses(parsed.from)[0] : { address: 'unknown' };

            return {
                uid: uid,
                date: parsed.date || new Date(),
                subject: parsed.subject || '(no subject)',
                from: from,
                to: mapAddresses(parsed.to),
                cc: mapAddresses(parsed.cc),
                hasAttachments: parsed.attachments && parsed.attachments.length > 0,
                seen: seen,
                size: source.length,
                html: parsed.html || undefined,
                text: parsed.text || undefined,
                attachments: (parsed.attachments || []).map(att => ({
                    filename: att.filename || 'unnamed',
                    contentType: att.contentType,
                    size: att.size,
                    disposition: att.contentDisposition
                })),
            };
        } finally {
            lock.release();
        }
    }

    /**
     * Deletes a message by adding the \Deleted flag.
     */
    async deleteMessage(folderPath: string, uid: number): Promise<void> {
        this.ensureConnected();
        const lock = await this.client!.getMailboxLock(folderPath);
        try {
            await this.client!.messageFlagsAdd(String(uid), ['\\Deleted'], { uid: true });
        } finally {
            lock.release();
        }
    }

    /**
     * Appends a message to a folder.
     * @param folderPath - Target folder path
     * @param message - Raw message content (Buffer or string)
     * @param flags - Optional flags to set (e.g. ['\\Seen'])
     */
    async appendMessage(folderPath: string, message: Buffer | string, flags: string[] = []): Promise<void> {
        this.ensureConnected();
        const lock = await this.client!.getMailboxLock(folderPath);
        try {
            await this.client!.append(folderPath, message, flags);
        } finally {
            lock.release();
        }
    }

    /**
     * Tests IMAP connection with the given credentials.
     */
    static async testConnection(account: IMailAccount, password: string): Promise<void> {
        const client = new ImapFlow({
            host: account.host,
            port: account.port,
            secure: account.secure,
            auth: {
                user: account.username,
                pass: password,
            },
            logger: false,
            verifyOnly: true, // Optimizes for connection testing
        });

        await client.connect();
        await client.logout();
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


}

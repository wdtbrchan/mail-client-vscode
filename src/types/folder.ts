/**
 * Represents an IMAP mailbox folder.
 */
export interface IMailFolder {
    /** Full path of the folder (e.g. "INBOX" or "INBOX/Subfolder") */
    path: string;
    /** Display name of the folder */
    name: string;
    /** Hierarchy delimiter (e.g. "/" or ".") */
    delimiter: string;
    /** Special-use flag if any (e.g. "\\Inbox", "\\Sent", "\\Drafts", "\\Trash", "\\Jstrash") */
    specialUse?: string;
    /** Child folders */
    children?: IMailFolder[];
    /** Total number of messages in the folder */
    totalMessages?: number;
    /** Number of unseen messages */
    unseenMessages?: number;
}

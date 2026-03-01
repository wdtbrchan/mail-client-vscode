/**
 * Represents an email address with optional display name.
 */
export interface IMailAddress {
    /** Display name (e.g. "John Doe") */
    name?: string;
    /** Email address (e.g. "john@example.com") */
    address: string;
}

/**
 * Represents an email attachment.
 */
export interface IMailAttachment {
    /** Filename of the attachment */
    filename: string;
    /** MIME content type */
    contentType: string;
    /** Size in bytes */
    size: number;
    /** Content disposition */
    disposition?: string;
}

/**
 * Represents a mail message header (used in message list).
 */
export interface IMailMessage {
    /** Unique ID within the mailbox */
    uid: number;
    /** Message date */
    date: Date;
    /** Subject line */
    subject: string;
    /** Sender address */
    from: IMailAddress;
    /** Recipient addresses */
    to: IMailAddress[];
    /** CC addresses */
    cc?: IMailAddress[];
    /** Whether the message has attachments */
    hasAttachments: boolean;
    /** Whether the message has been read */
    seen: boolean;
    /** Message size in bytes */
    size: number;
}

/**
 * Represents a full mail message with body content.
 */
export interface IMailMessageDetail extends IMailMessage {
    /** HTML body content */
    html?: string;
    /** Plain text body content */
    text?: string;
    /** List of attachments */
    attachments: IMailAttachment[];
    /** Original Message-ID header */
    messageId?: string;
    /** Whether SPF check passed */
    spfValid?: boolean;
    /** Whether DKIM check passed */
    dkimValid?: boolean;
}

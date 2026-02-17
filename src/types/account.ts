/**
 * Represents a mail account configuration (IMAP + SMTP).
 * Passwords are stored separately via VS Code SecretStorage.
 */
export interface IMailAccount {
    /** Unique identifier for the account */
    id: string;
    /** Display name for the account */
    name: string;

    // --- IMAP (incoming) ---
    /** IMAP server hostname */
    host: string;
    /** IMAP server port */
    port: number;
    /** Whether to use SSL/TLS for IMAP */
    secure: boolean;
    /** Login username (usually email address) */
    username: string;

    // --- SMTP (outgoing) ---
    /** SMTP server hostname */
    smtpHost: string;
    /** SMTP server port (default 587 for STARTTLS, 465 for SSL) */
    smtpPort: number;
    /** Whether to use SSL/TLS for SMTP */
    smtpSecure: boolean;
    /** SMTP username – if empty, uses IMAP username */
    smtpUsername?: string;
}


import * as nodemailer from 'nodemailer';
import { IMailAccount } from '../types/account';

export interface ISendMailOptions {
    /** Sender display name + address, e.g. "John <john@x.com>" */
    from: string;
    /** Comma-separated recipient addresses */
    to: string;
    /** Comma-separated CC addresses (optional) */
    cc?: string;
    /** Comma-separated BCC addresses (optional) */
    bcc?: string;
    /** Email subject */
    subject: string;
    /** HTML body */
    html: string;
    /** Plain-text fallback */
    text?: string;
    /** In-Reply-To header (for threading) */
    inReplyTo?: string;
    /** References header (for threading) */
    references?: string;
}

/**
 * Handles SMTP communication for sending emails.
 * Wraps nodemailer with typed interfaces.
 */
export class SmtpService {

    /**
     * Sends an email via SMTP using account credentials.
     */
    static async sendMail(
        account: IMailAccount,
        smtpPassword: string,
        options: ISendMailOptions,
    ): Promise<void> {
        const transport = nodemailer.createTransport({
            host: account.smtpHost,
            port: account.smtpPort,
            secure: account.smtpSecure,
            auth: {
                user: account.smtpUsername || account.username,
                pass: smtpPassword,
            },
        });

        try {
            await transport.sendMail({
                from: options.from,
                to: options.to,
                cc: options.cc || undefined,
                bcc: options.bcc || undefined,
                subject: options.subject,
                html: options.html,
                text: options.text || undefined,
                inReplyTo: options.inReplyTo || undefined,
                references: options.references || undefined,
            });
        } finally {
            transport.close();
        }
    }

    /**
     * Tests SMTP connection with the given credentials.
     */
    static async testConnection(
        account: IMailAccount,
        smtpPassword: string,
    ): Promise<boolean> {
        const transport = nodemailer.createTransport({
            host: account.smtpHost,
            port: account.smtpPort,
            secure: account.smtpSecure,
            auth: {
                user: account.smtpUsername || account.username,
                pass: smtpPassword,
            },
        });

        try {
            await transport.verify();
            return true;
        } finally {
            transport.close();
        }
    }
}

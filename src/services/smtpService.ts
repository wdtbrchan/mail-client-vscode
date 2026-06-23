import * as nodemailer from 'nodemailer';
import { IMailAccount } from '../types/account';
import { OAuthService } from './oauthService';

/**
 * Builds the nodemailer auth object for an account, using XOAUTH2 access tokens
 * for OAuth2 accounts and a password otherwise.
 */
async function buildSmtpAuth(account: IMailAccount, smtpPassword: string): Promise<any> {
    const user = account.smtpUsername || account.username;
    if (account.authType === 'oauth2') {
        const accessToken = await OAuthService.getInstance().getAccessToken(account);
        return { type: 'OAuth2', user, accessToken };
    }
    return { user, pass: smtpPassword };
}

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
    /** Raw message content (Buffer or string) - overrides other options if present */
    raw?: string | Buffer;
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
            auth: await buildSmtpAuth(account, smtpPassword),
        });

        try {
            if (options.raw) {
                await transport.sendMail({
                    raw: options.raw,
                    envelope: {
                        from: options.from,
                        to: options.to,
                        cc: options.cc,
                        bcc: options.bcc,
                    }
                });
            } else {
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
            }
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
            auth: await buildSmtpAuth(account, smtpPassword),
        });

        try {
            await transport.verify();
            return true;
        } finally {
            transport.close();
        }
    }
}

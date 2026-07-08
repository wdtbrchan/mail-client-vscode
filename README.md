<p align="center">
  <img src="docs/logo.png" alt="Mail Client Logo" width="200" />
</p>

# Mail Client
A simple and efficient IMAP email client directly within your VS Code (or any other compatible editor like Cursor or Antigravity). In Markdown mode, you can leverage AI autocomplete to assist with writing your email text.

![Screenshot](docs/screenshot.jpg)


## Features

- **Account Management:** Add, edit, and remove IMAP accounts through a user-friendly interface.
- **Email Browsing & Search:** Access folders from the sidebar, browse messages, and search within folders using IMAP search features.
- **Compose Interface:** WYSIWYG rich text editor with Markdown fallback mode.
- **Basic Operations:** Reply to messages, forward, and delete emails.
- **Attachments:** Support for uploading and downloading email attachments. Added support for local file selection even when connected to Remote SSH.
- **Folder Management:** Map special folders and create custom folder buttons.
- **Image Whitelist:** Whitelist trusted senders to automatically load remote images in future emails.
- **Organize Messages:** Archive, Spam, Trash, and Inbox actions with context-aware buttons.
- **Address Book:** Manage your email contacts and use autocomplete in the `To`, `Cc`, and `Bcc` fields. Add unknown contacts easily with a single click.
- **Jira Integration:** Pair emails with Jira issues, post comments, and open issues directly in the browser from the message detail view.
- **Notes & Org Integration:** Copy a stable link to an email or capture it as a task (org-mode TODO by default) into a configurable file. Links reopen the exact email later via a URI handler — works with org-mode link extensions and across editors (Cursor, VSCodium, …).
- **Print Support:** Capability to print messages via the native OS prompt directly from the UI.
- **Customizable Layout:** Choose between Side or Bottom panel for viewing message details in Split View.
- **Calendar Support:** View calendar invite (ICS) details directly in the email, including time, location, and attendees.
- **Connection Reliability:** Configurable keepalive mechanism using IMAP `NOOP` commands to prevent session timeouts.

## Requirements

- VS Code version 1.85.0 or newer.
- IMAP account (e.g., Gmail, Outlook, custom server).


## Account Setup

Open the Mail Client sidebar and click **+ Add Mail Account**. Pick an **Account Type** and follow the matching guide below. Server addresses are pre-filled for Gmail and Outlook.

### Gmail (App Password)

Google no longer allows signing in to IMAP/SMTP with your normal account password, and it does not offer free OAuth2 for third-party mail clients (the `https://mail.google.com/` scope is a *restricted* scope requiring a paid annual security assessment). The supported, free way is an **App Password**:

1. Turn on **2-Step Verification** for your Google account: [myaccount.google.com/security](https://myaccount.google.com/security).
2. Create an App Password: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Give it a name (e.g. `VS Code Mail Client`) and copy the generated 16-character password.
3. In the extension, add an account with **Account Type → Gmail (App Password)**:
   - **Username:** your full Gmail address
   - **Password:** the 16-character App Password (not your normal password)
   - IMAP `imap.gmail.com:993` (SSL) and SMTP `smtp.gmail.com:465` (SSL) are filled in automatically.
4. Click **Test Connection** and **Save**.

> **Notes**
> - App Passwords require 2-Step Verification to be enabled.
> - On a **Google Workspace** (business/school) account, the administrator may have disabled App Passwords. In that case IMAP access must be enabled/authorized by your admin.
> - You can revoke the App Password at any time from the same Google page.

### Outlook / Microsoft 365 (OAuth2)

Microsoft has removed Basic Authentication (passwords/app passwords) for Outlook and Microsoft 365 mailboxes, so these accounts use **OAuth2**. This is free and requires no security audit.

1. In the extension, add an account with **Account Type → Microsoft 365 / Outlook (OAuth2)**:
   - **Username:** your full email address (e.g. `you@outlook.com` or your work address)
   - IMAP `outlook.office365.com:993` (SSL) and SMTP `smtp.office365.com:587` (STARTTLS) are filled in automatically.
2. Click **Sign in** and complete the Microsoft login/consent in your browser.
3. Click **Test Connection** and **Save**. No password is stored — the extension keeps a short-lived token and refreshes it automatically.

> **Notes**
> - Works with personal accounts (`outlook.com`, `hotmail.com`, `live.com`) and work/school accounts.
> - On some organization tenants an administrator must approve the app before you can consent; this is controlled by your organization, not the extension.

### Other IMAP servers

Choose **Account Type → IMAP + Password / App Password** and enter your server's IMAP/SMTP host, port, username, and password manually.


## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

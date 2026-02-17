# Changelog

## [ upcoming ]

### Added
- **Folder Management**: Configure special folders (Sent, Drafts, Trash, Spam, Archive, Newsletters) and custom folders in account settings.
- **Message Actions**: Added Archive, Spam, Trash, and Newsletter buttons to message detail view.
- **Smart Delete**: Context-aware "Trash" vs "Delete" buttons (permanent delete only available in Trash folder).
- **Custom Buttons**: Dynamic buttons for moving messages to user-defined custom folders.
- **Sent Folder**: Automatically save sent messages to the specified IMAP folder (default "Sent").

## [0.1.0] - 2026-02-17

### Added
- Basic IMAP integration using `imapflow`.
- Mail Explorer in the sidebar.
- Account management (add, edit, remove).
- Message list and message detail in webview.
- Basic message actions: Reply, Reply All, Forward, Delete.
- Support for locale settings and refresh interval.
- Support for opening folders in a new tab.
- **Compose Message**: Write emails in markdown with live preview, send via SMTP.
- Improved email parsing with `mailparser` for better body extraction.
- Fixed date localization in message detail view.


# Changelog

## [ upcoming ]

### Changed
- **Improved Reply/Forward Headers**: Replaced simple "wrote:" line with a structured header (Separator, From, To, Date, Subject).
- **Message Quoting**: Original message content is now properly indented in both sent emails and the compose preview.

## [0.2.2]

### Changed
- Updated roadmap in `TODO.md`.
- Updated `README.md` with logo centering, refined logo and description, and updated feature list.
- Synchronized `package-lock.json` with `package.json` license metadata.

## [0.2.1]

### Added
- Added extension logo.
- Added extension tags and metadata to `package.json`.

### Changed
- Updated extension publisher and license in `package.json`.
- Added `build_extension.ps1` helper script for VSIX creation.

## [0.2.0]

### Added
- **Attachment Support**: Upload attachments when composing and download attachments from received messages.
- **Folder Management**: Configure special folders (Sent, Drafts, Trash, Spam, Archive, Newsletters) and custom folders in account settings.
- **Message Actions**: Added Archive, Spam, Trash, and Newsletter buttons to message detail view.
- **Smart Delete**: Context-aware "Trash" vs "Delete" buttons (permanent delete only available in Trash folder).
- **Custom Buttons**: Dynamic buttons for moving messages to user-defined custom folders.
- **Sent Folder**: Automatically save sent messages to the specified IMAP folder (default "Sent").
- **Mark as Read**: Automatically mark messages as read when opened in detail view.
- **Show Images**: Fixed "Show Images" functionality and improved UI/UX for blocked content.
- **UI Consistency**: Reply/Forward view now uses the same rendering engine as Message Detail.
- **WYSIWYG Editor**: Added a new rich text editor mode for composing emails, enabled by default with support for basic formatting (bold, italic, underline, lists).
- **Compose Mode**: New setting `mailClient.composeMode` to toggle between WYSIWYG and Markdown file-based editing.
- **Improved Body Styling**: Added margins and better default padding for email content in webview to ensure better readability.
- **UI Tweaks**: Refined editor colors (white background/black text) to match standard email experience.
- **Message List Redesign**: Modern flexbox layout with unread indicators, attachment icons, hover action buttons (SVG arrows), and improved date formatting.

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


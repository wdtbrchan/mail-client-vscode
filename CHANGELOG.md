# Changelog

## [ upcoming ]

### Added
- **Auto-focus**: The message body now automatically receives focus when opening the compose panel for a new message, reply, or forward. This works in both WYSIWYG and Markdown modes.
- **Markdown Preview Label**: Styled the "Preview" heading in Markdown mode as a subtle grey corner badge to distinguish it from message content.

## [0.3.0]

### Added
- **Print Functionality**: Added a print button to the message detail toolbar, allowing users to print emails. The print preview opens in the default system browser to bypass VS Code webview sandbox restrictions.
- **Enhanced WYSIWYG Formatting**: Added more formatting options to the WYSIWYG editor, including strikethrough, indent/outdent, blockquote, monospace font, and a "clear formatting" tool.
- **WYSIWYG Monospace Toggle**: The monospace button now toggles the font between monospace and the default UI font.
- **Cross-mode Switching**: Added a "Switch to WYSIWYG mode" link to the Markdown editor for easier transitions between editing modes.
- **Email Signatures**: Added support for both HTML/Rich Text and Markdown signatures in account settings.

### Changed
- **WYSIWYG Toolbar Redesign**: Moved formatting buttons from the editor body to the top action bar for a cleaner, shared interface with Send/Discard actions.
- **Improved UI Elements**: Buttons in the compose panel now use consistent icons with tooltips.
- **Compose Button Visibility**: The "Send" button is now larger and more prominent for better usability.
- **WYSIWYG Rendering Fix**: The original message is now displayed in an isolated iframe below the WYSIWYG editor instead of being part of the editable content. This ensures the original email's dark/light mode styling is preserved and prevents background color conflicts while composing.
- **Signature Styling**: Removed the automatically added horizontal line (`---`) before the signature in Markdown mode.
- **Message Detail UI**: Repositioned action bar under message headers for better flow.
- **Improved Layout**: Folder actions (Archive, Spam, etc.) moved to the left, while Reply/Forward actions moved to the right in the detail view.
- **Button Icons**: Replaced text labels with consistent SVG icons for Reply, Reply All, and Forward buttons in both message list and detail views.
- **Message List**: Standardized button order (Forward, Reply, Reply All) to match the detail view and improved hover animations.
- **Compose View**: Swapped Send and Discard buttons (Send is now on the right) for better ergonomics.
- **Improved Reply/Forward Headers**: Replaced simple "wrote:" line with a structured header (Separator, From, To, Date, Subject).
- **Message Quoting**: Original message content is now properly indented in both sent emails and the compose preview.
- **Compose UI Refinement**: Moved Send and Discard buttons to the top-right of the compose panel for better visibility.
- **Modernized UI (Tiled Toolbars)**: Redesigned all action bars and toolbars (message list, detail view, compose panel) to use a "tiled" layout with seamless borders and a fixed 36px height.
- **Visual Feedback**: Implemented a consistent, high-visibility orange hover effect for all toolbar and action buttons.
- **Show Images Tweak**: The "Show images" warning bar now follows the tiled design pattern.
- **Action Buttons**: Message list action buttons (Reply, Forward) are now part of a tiled container with the new orange highlight style.

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


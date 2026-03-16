# Changelog

## [ upcoming ]
- **Jira**: Added "Open" button to open the paired Jira issue directly in the browser. Widened the Jira modal dialog slightly for better fit.

## [0.16.0]
- **Message Detail**: Added support for displaying calendar invites (ICS files). The detail view now shows meeting summary, time, location, organizer, and attendees directly above the message body.

## [0.15.2]
- **IMAP Service**: Added an automatic reconnection attempt when opening a message if the connection was lost.

## [0.15.1]
- **Compose**: Improved address book autocomplete to correctly handle commas within quoted names.
- **Compose**: Names containing commas are now automatically quoted when selected from the autocomplete list.
- **Compose**: Automatically strip trailing commas from `To`, `Cc`, and `Bcc` fields before sending an email.
- **UI Design**: Improved visibility of the address autocomplete dropdown with a standard VS Code focus border and slightly different background.

## [0.15.0]
- **Address Book**: Added a new "Address Book" feature with contact management and autocomplete functionality.
- **Contacts**: New `mailClient.contacts` configuration setting for storing email addresses with display names.
- **Message Detail**: Added an inline `[+]` button next to unknown email addresses to quickly add them to the contacts list.
- **Compose**: Implemented email address autocomplete for `To`, `Cc`, and `Bcc` fields using the contact list, with support for multiple comma-separated addresses and keyboard navigation.

## [0.14.0]
- **Message Move**: Added an "Undo" option to the move notification, allowing users to quickly revert moving messages between folders.

## [0.13.10]
- **Unread Count**: Added the unread message count to the folder tab title (e.g., `INBOX (3)`). The count is automatically updated when messages are marked as read or folders are refreshed.
- **Performance**: Optimized unread count synchronization when marking messages as read in the detail view by updating the local folder cache directly, avoiding unnecessary IMAP `list` calls.
- **Unread Count**: Restricted the Activity Bar unread count badge to only sum messages from the "Inbox" folder, preventing unread messages in other folders (like Junk or Sent) from affecting the total badge count.

## [0.13.9]
- **Markdown Preview**: Fixed background and font colors for code blocks (`<pre>` and `<code>`) in the markdown preview to consistently use a white background and black text, matching the final output.

## [0.13.8]
- **Outgoing Mail**: Stripped markdown formatting from the plain text part of emails sent in Markdown compose mode to prevent raw markdown syntax from appearing in the text-only version of messages.

## [0.13.7]
- **Message List**: In the "Sent" folder, the recipient list (To, Cc, Bcc) is now displayed instead of the sender's display name to improve folder scanability.

## [0.13.6]
- **IMAP Service**: Added a configurable keepalive (NOOP) mechanism to prevent connection drops due to inactivity. The interval can be customized via the `mailClient.keepaliveInterval` setting (default 60s).
- **Attachments (Remote SSH)**: Added ability to attach files from the local machine when connected via Remote SSH. Uses the browser's native file picker (`<input type="file">`) which always accesses the local filesystem, bypassing VS Code's remote-only file dialog limitation.
 
## [0.13.5]
- **IMAP Service**: Added a configurable keepalive (NOOP) mechanism to prevent connection drops due to inactivity. The interval can be customized via the `mailClient.keepaliveInterval` setting (default 60s).
- **Attachments**: Hidden the "Attach Local Files" button when connected to a remote host, as VS Code only supports remote file selection in this environment.
 
## [0.13.4]
- **Attachments**: Added "Show Local" button to the attachment picker in remote environments.
- **Attachments**: Added a dedicated "Attach Remote Files" button when connected to a remote host (SSH/WSL) for direct access to the remote file system.
- **Attachments**: Refactored attachment loading to use `vscode.workspace.fs`, enabling seamless attachment handling from both local and remote sources.

## [0.13.3]

### Changed
- **UI Design**: Removed extra margins and padding from the message detail body to allow content to fill the entire width of the panel.

## [0.13.2]

### Changed
- **Documentation**: Added a screenshot of the application to the `README.md` for better visual representation.

## [0.13.1]

### Changed
- **UI Design**: Increased font size and tučnost for message subjects in the list to make them more dominant and distinct from the sender's display name.
- **UI Design**: Replaced the colored emoji folder icon (`📂`) with a modern, monochrome SVG outline icon for custom folders in the message list to maintain visual consistency with other action buttons.

## [0.13.0]

### Added
- **Message List Actions**: Added hover action buttons to the message list for quick folder management.

### Changed
- **UI Design**: Updated action buttons in both message list and message detail views to a modern icon-only design using large outline SVG icons. Removed text labels from the detail view to reduce UI clutter (info now available via tooltips).

## [0.12.0]

### Changed
- **Jira Integration**: The "Pair to JIRA issue" modal now remains open after successful pairing and displays a "Saved" message, allowing the user to immediately add a comment without reopening the modal.
- **Jira Integration**: The "Comment" button in the pairing modal is now only visible if the entered issue key matches the currently paired issue.
- **Jira Integration**: Improved robustness of stripping the original message from Jira comments, correctly handling quoted text and varied separator formats.

## [0.11.0]

### Added
- **Message Pagination**: Added support for paginating through the message list. Users can now configure the number of messages downloaded per page via the `mailClient.messagesPerPage` setting (default is 50). Improved UI pagination controls with adaptive size and spacing.
- **Message Detail Location**: Added a new setting `mailClient.detailPanelLocation` which allows users to choose whether the message detail panel opens in a side panel (default) or a bottom panel when using Split View mode.

## [0.10.2]

### Fixed
- **Outgoing Mail**: Fixed an issue where the plain text part (`text/plain`) was not properly generated in WYSIWYG mode or missing the quoted original message in both modes.
- **Jira Integration**: Shortened the JIRA pairing button label from "JIRA #KEY" to "#KEY" for a more compact UI in the message detail view.

## [0.10.1]

### Fixed
- **Jira Integration**: Fixed an issue where the quoted email history (e.g., "Original message") was sometimes included in the Jira comment extraction, especially for HTML messages in the Sent folder.

## [0.10.0]

### Added
- **Account Settings**: Added support for Jira API Key / Auth Token in account configuration.
- **Jira Integration**: Added ability to pair e-mail messages with Jira issues. Pairing is persisted based on the email subject (thread-based) to ensure all messages in a conversation share the same Jira link.
- **Jira Integration**: Integrated a WYSIWYG comment editor in the message detail view.
- **Jira Integration**: Issue search with up to 3 results and clickable issue keys for quick pairing.

### Changed
- **Account Settings**: Default visibility of sections updated: "Jira Integration" is now collapsed by default and moved to the bottom, while "Folders" is now expanded by default.
- **Jira Integration**: The "JIRA" button in the message detail view is now hidden if no API key is configured for the account.
- **Refactoring**: Refactored `messageDetailPanel.ts` to separate HTML, CSS, and JS into dedicated template files (`src/panels/views/messageDetail/`) for better maintainability and syntax highlighting.

## [0.9.3]

### Changed
- **Refactoring**: Refactored `composePanel.ts` to separate HTML, CSS, and JS into dedicated template files (`src/panels/views/compose/`) for better maintainability and syntax highlighting.
- **Build System**: Added a custom esbuild plugin to bundle view-specific scripts as raw text for webview injection.

### Fixed
- **Compose View**: Fixed image blocking in the WYSIWYG editor for replies and forwards; images now correctly respect the sender whitelist and manual unblocking from the message detail view.
- **UI & Logging**: Translated Czech `showWarningMessage` and `console` statements to English and shortened them for better conciseness.


## [0.9.2]

### Fixed
- **Outgoing Mail**: Properly quoted the sender's display name in the `From` header to ensure it displays correctly in recipient clients even when containing commas (RFC 5322 compliance).

## [0.9.1]

### Fixed
- **Image Whitelist**: External images are now correctly loaded in reply/forward messages if they were allowed in the original message detail view.
- **Image Whitelist**: Fixed an issue where the "External images blocked" warning was injected into the original message body when replying or forwarding.

## [0.9.0]

### Added
- **Image Whitelist**: Added a new "Always load from [email]" button when external images are blocked. Users can now whitelist trusted senders to automatically load remote images in future emails.
- **Spam Protection**: Enhanced security by ensuring remote images are always blocked by default in the Spam folder, even if the sender is on the whitelist.

## [0.8.1]

### Added
- **Horizontal Scrollbar**: Added a horizontal scrollbar to the message detail.

## [0.8.0]

### Added
- **WYSIWYG Font Size**: Added a new dropdown menu in the WYSIWYG editor to select between 5 different text sizes (very small, small, normal, big, very big).
- **Send + Archive**: Added a new secondary send action in the compose panel (for replies and forwards) that automatically moves the original message to the Archive folder after sending.
- **Icon-only Buttons**: Updated the "Send" and "Send + Archive" buttons to use a modern, icon-only design with a borderless style and orange hover effects.
- **Compact Mode Toggle**: Refactored the Markdown/WYSIWYG mode switching buttons into a pair of compact, labeled buttons with active state highlighting.

### Changed
- **WYSIWYG Toolbar**: Refactored formatting buttons to a new, centered row for better layout and accessibility.

### Fixed
- **Sender Name Display**: Fixed an issue where the account name was shown instead of the configured sender name in the compose/reply panel.
- **Instant Folder Sync**: Improved folder synchronization after archiving from the compose panel by reusing the primary IMAP connection for the move operation.
- **Workflow Continuity**: The message detail panel now automatically navigates to the next available message after an email is sent and the original is archived.

## [0.7.0]

### Added
- **Message Move Flow**: The message detail panel now remains open after moving a message (Archive, Trash, Spam, etc.) or deleting it.
- **Auto-navigation**: After a message is moved or deleted, the next available message in the current folder is automatically loaded and displayed.
- **Active Highlight**: The currently opened message is now visually highlighted in the message list for better navigation context.

### Fixed
- **Sender Name Display**: Fixed an issue where the account name was shown instead of the configured sender name in the compose/reply panel.
- **Sender Name Parsing**: Fixed an issue where names containing commas (e.g., "Doe, John") were truncated in the message list and detail view.

## [0.6.0]

### Added
- **Sender Name**: Added a new field in account settings to configure a custom display name (`senderName`) for outgoing emails, independent of the general account name. 

### Changed
- **Connection Errors**: Removed automatic background reconnections which caused infinite loading loops. Connection errors are now displayed as a tooltip on a warning item in the folder tree, requiring a manual refresh to reconnect.
- **Message Detail UI**: Action bar in message detail view is now responsive. Folder action buttons automatically wrap on smaller screens, while reply/forward/print buttons stay aligned to the right.
- **Action Buttons**: Replaced text labels with larger SVG icons for "New Message" and "Refresh" buttons to improve visual hierarchy and reduce UI clutter. Tooltips are added for clarity.

## [0.5.0]

### Added
- **Message Search**: Added the ability to search for messages within a folder using IMAP search features. A search input is now available in the message list toolbar.
- **Message Actions**: Added an "Inbox" button to the message detail view to quickly move messages back to the inbox.
- **Smart Action Buttons**: Action buttons (Inbox, Archive, Spam, Newsletters, Trash, and Custom Folders) are now automatically hidden when the message is already residing in the respective folder.

### Changed
- **Message Detail Layout**: The message header and action toolbar are now fixed to the top of the panel, ensuring they remain visible while scrolling through long message content.

## [0.4.2]

### Added
- **Calendar Support**: View calendar invite (ICS) details directly in the email, including time, location, and attendees.
- **Connection Reliability**: Implemented automatic IMAP reconnection and robust connection state monitoring to prevent "Connection not available" errors.
- **Forced Refresh**: The refresh button in Mail Explorer now forces a complete reconnection to resolve any stuck connections.
- **Loading Indicators**: Integrated visual loading spinners to improve user feedback.

## [0.4.1]

### Fixed
- **External Links**: Resolved an issue where external links in the email body were blocked by the webview sandbox. Intercepted link clicks in the email content iframe and routed them through VS Code's native `openExternal` handler to ensure they open in the default web browser. This fix applies to message detail view, print preview, and quoted messages in the compose panel.
- **Message Date Parsing**: Improved message sorting by utilizing the IMAP `internalDate` as a fallback when the `Date` header is missing or improperly formatted by the server.
- **Sent Folder Detection**: The extension now intelligently detects the correct "Sent" folder across different IMAP servers by checking for the `\Sent` special-use attribute or matching common names (e.g., 'sent', 'outbox').
- **Save to Sent Folder**: Discarding silent IMAP append failures and now properly informing the user via a UI warning when an email fails to save to the Sent folder after being successfully sent.

## [0.4.0]

### Added
- **Message Display Mode**: Added `mailClient.messageDisplayMode` setting with three modes: Within List (Preview), New Window, and Split View (Beside). "Split View" is now the default mode.
- **Embedded Detail View**: Implemented a reusable embedded message detail view with a dedicated "Back" button for the "Within List" display mode.
- **Optimized Split View**: Enhanced the Split View mode to preserve manually set panel widths and implemented state restoration to remember the panel layout after editor restarts.
- **Auto-focus**: The message body now automatically receives focus when opening the compose panel for a new message, reply, or forward. This works in both WYSIWYG and Markdown modes.
- **Markdown Preview Label**: Styled the "Preview" heading in Markdown mode as a subtle grey corner badge to distinguish it from message content.

### Changed
- **Account Settings UI**: Redesigned the account settings panel with a cleaner, more organized layout using collapsible sections for Folders and Signatures.
- **Connection Testing**: Improved IMAP connection testing by resolving logic errors and displaying results (both IMAP and SMTP) directly next to buttons for immediate feedback.
- **Layout Refinements**: Optimized the "Load Folders" button placement and improved vertical spacing between HTML and Markdown signature editors.
- **CSP Compliance**: Refactored the settings panel to use CSS classes instead of inline styles, resolving Content Security Policy violations and improving security.
- **Message List Actions**: Hidden reply, reply-all, and forward action buttons in the message list when Split View mode is active to reduce UI clutter.


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

import * as vscode from 'vscode';
import { MailExplorerProvider, MailTreeItem } from '../providers/mailExplorerProvider';
import { MessageListPanel } from '../panels/messageListPanel';
import { MessageDetailPanel } from '../panels/messageDetailPanel';

/**
 * Registers all message-related commands.
 */
export function registerMessageCommands(
    context: vscode.ExtensionContext,
    explorerProvider: MailExplorerProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mailClient.openFolder', (item: MailTreeItem) => {
            if (!item?.folderPath) {
                return;
            }
            MessageListPanel.showInActive(
                explorerProvider,
                item.accountId,
                item.folderPath,
                item.label as string,
            );
        }),

        vscode.commands.registerCommand('mailClient.openFolderInNewTab', (item: MailTreeItem) => {
            if (!item?.folderPath) {
                return;
            }
            MessageListPanel.show(
                explorerProvider,
                item.accountId,
                item.folderPath,
                item.label as string,
            );
        }),

        vscode.commands.registerCommand('mailClient.openMessage', (args: {
            accountId: string;
            folderPath: string;
            uid: number;
        }) => {
            if (!args) {
                return;
            }
            MessageDetailPanel.show(
                explorerProvider,
                args.accountId,
                args.folderPath,
                args.uid,
            );
        }),

        vscode.commands.registerCommand('mailClient.reply', (args: {
            accountId: string;
            folderPath: string;
            uid: number;
        }) => {
            // TODO: Implement SMTP reply functionality
            vscode.window.showInformationMessage('Reply functionality will be implemented with SMTP support.');
        }),

        vscode.commands.registerCommand('mailClient.replyAll', (args: {
            accountId: string;
            folderPath: string;
            uid: number;
        }) => {
            // TODO: Implement SMTP reply-all functionality
            vscode.window.showInformationMessage('Reply All functionality will be implemented with SMTP support.');
        }),

        vscode.commands.registerCommand('mailClient.forward', (args: {
            accountId: string;
            folderPath: string;
            uid: number;
        }) => {
            // TODO: Implement SMTP forward functionality
            vscode.window.showInformationMessage('Forward functionality will be implemented with SMTP support.');
        }),

        vscode.commands.registerCommand('mailClient.deleteMessage', async (args: {
            accountId: string;
            folderPath: string;
            uid: number;
        }) => {
            if (!args) {
                return;
            }
            try {
                const service = explorerProvider.getImapService(args.accountId);
                await service.deleteMessage(args.folderPath, args.uid);

                const { MessageListPanel } = await import('../panels/messageListPanel');
                MessageListPanel.refreshFolder(args.accountId, args.folderPath);
                explorerProvider.refresh();

                vscode.window.showInformationMessage('Message deleted.');
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Failed to delete message';
                vscode.window.showErrorMessage(`Delete failed: ${errorMsg}`);
            }
        }),
    );
}

import * as vscode from 'vscode';
import { MailExplorerProvider, MailTreeItem } from '../providers/mailExplorerProvider';
import { MessageListPanel } from '../panels/messageListPanel';
import { MessageDetailPanel } from '../panels/messageDetailPanel';
import { ComposePanel, ComposeMode } from '../panels/composePanel';
import { AccountManager } from '../services/accountManager';

/**
 * Registers all message-related commands.
 */
export function registerMessageCommands(
    context: vscode.ExtensionContext,
    explorerProvider: MailExplorerProvider,
    accountManager: AccountManager,
): void {

    /**
     * Opens the compose panel for reply/replyAll/forward.
     * Loads the original message from IMAP and opens the editor + preview.
     */
    async function openCompose(
        mode: ComposeMode,
        args?: { accountId: string; folderPath: string; uid: number },
    ): Promise<void> {
        try {
            let account;

            if (args) {
                // Reply/Forward – we know the account
                account = accountManager.getAccount(args.accountId);
            } else {
                // New compose – let user pick an account if multiple
                const accounts = accountManager.getAccounts();
                if (accounts.length === 0) {
                    vscode.window.showWarningMessage('No mail accounts configured.');
                    return;
                }
                if (accounts.length === 1) {
                    account = accounts[0];
                } else {
                    const picked = await vscode.window.showQuickPick(
                        accounts.map(a => ({ label: a.name, description: a.username, id: a.id })),
                        { placeHolder: 'Select account to send from' },
                    );
                    if (!picked) {
                        return;
                    }
                    account = accounts.find(a => a.id === picked.id);
                }
            }

            if (!account) {
                vscode.window.showErrorMessage('Account not found.');
                return;
            }

            let originalMessage;
            if (args && mode !== 'compose') {
                const service = explorerProvider.getImapService(args.accountId);
                originalMessage = await service.getMessage(args.folderPath, args.uid);
            }

            await ComposePanel.open(accountManager, {
                account,
                mode,
                originalMessage,
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to open compose';
            vscode.window.showErrorMessage(errorMsg);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('mailClient.openFolder', (item: MailTreeItem) => {
            if (!item?.folderPath) {
                return;
            }
            MessageListPanel.showInActive(
                explorerProvider,
                accountManager,
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
                accountManager,
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
                accountManager,
                args.accountId,
                args.folderPath,
                args.uid,
            );
        }),

        vscode.commands.registerCommand('mailClient.compose', (args?: { accountId: string }) => {
            openCompose('compose', args as any);
        }),

        vscode.commands.registerCommand('mailClient.reply', (args: {
            accountId: string;
            folderPath: string;
            uid: number;
        }) => {
            openCompose('reply', args);
        }),

        vscode.commands.registerCommand('mailClient.replyAll', (args: {
            accountId: string;
            folderPath: string;
            uid: number;
        }) => {
            openCompose('replyAll', args);
        }),

        vscode.commands.registerCommand('mailClient.forward', (args: {
            accountId: string;
            folderPath: string;
            uid: number;
        }) => {
            openCompose('forward', args);
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

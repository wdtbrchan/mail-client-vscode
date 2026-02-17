import * as vscode from 'vscode';
import { AccountManager } from '../services/accountManager';
import { AccountSettingsPanel } from '../panels/accountSettingsPanel';
import { MailExplorerProvider, MailTreeItem } from '../providers/mailExplorerProvider';

/**
 * Registers all account-related commands.
 */
export function registerAccountCommands(
    context: vscode.ExtensionContext,
    accountManager: AccountManager,
    explorerProvider: MailExplorerProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mailClient.addAccount', () => {
            AccountSettingsPanel.show(accountManager, context.extensionUri);
        }),

        vscode.commands.registerCommand('mailClient.editAccount', (item?: MailTreeItem) => {
            if (!item || item.itemType !== 'account') {
                vscode.window.showErrorMessage('Select an account to edit.');
                return;
            }
            const account = accountManager.getAccount(item.accountId);
            if (account) {
                AccountSettingsPanel.show(accountManager, context.extensionUri, account);
            }
        }),

        vscode.commands.registerCommand('mailClient.removeAccount', async (item?: MailTreeItem) => {
            if (!item || item.itemType !== 'account') {
                vscode.window.showErrorMessage('Select an account to remove.');
                return;
            }

            const account = accountManager.getAccount(item.accountId);
            if (!account) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Remove account "${account.name}"? This cannot be undone.`,
                { modal: true },
                'Remove',
            );

            if (confirm === 'Remove') {
                await accountManager.removeAccount(account.id);
                vscode.window.showInformationMessage(`Account "${account.name}" removed.`);
            }
        }),

        vscode.commands.registerCommand('mailClient.refreshAccount', async (item?: MailTreeItem) => {
            if (!item || item.itemType !== 'account') {
                return;
            }

            const account = accountManager.getAccount(item.accountId);
            if (!account) {
                return;
            }

            const password = await accountManager.getPassword(account.id);
            if (!password) {
                vscode.window.showErrorMessage('No password configured for this account.');
                return;
            }

            try {
                // Disconnect and reconnect
                const service = explorerProvider.getImapService(account.id);
                if (service.connected) {
                    await service.disconnect();
                }
                await explorerProvider.connectAccount(account, password);
                explorerProvider.refresh(item);
                vscode.window.showInformationMessage(`Account "${account.name}" refreshed.`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Refresh failed';
                vscode.window.showErrorMessage(`Failed to refresh: ${errorMsg}`);
            }
        }),
    );
}

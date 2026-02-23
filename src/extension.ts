import * as vscode from 'vscode';
import { AccountManager } from './services/accountManager';
import { MailExplorerProvider } from './providers/mailExplorerProvider';
import { registerAccountCommands } from './commands/accountCommands';
import { registerMessageCommands } from './commands/messageCommands';
import { MessageListPanel } from './panels/messageListPanel';
import { MessageDetailPanel } from './panels/messageDetailPanel';

let explorerProvider: MailExplorerProvider | undefined;

/**
 * Extension activation entry point.
 * Sets up the account manager, tree view, and all commands.
 */
export function activate(context: vscode.ExtensionContext): void {
    const accountManager = new AccountManager(context);
    explorerProvider = new MailExplorerProvider(accountManager);

    // Register the Mail Explorer tree view
    const treeView = vscode.window.createTreeView('mailExplorer', {
        treeDataProvider: explorerProvider,
        showCollapseAll: true,
    });
    explorerProvider.setTreeView(treeView);
    context.subscriptions.push(treeView);

    // Register commands
    registerAccountCommands(context, accountManager, explorerProvider);
    registerMessageCommands(context, explorerProvider, accountManager);

    // Open extension settings command
    context.subscriptions.push(
        vscode.commands.registerCommand('mailClient.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:wdtbrchan.mail-client-vscode');
        }),
    );

    // Refresh all folders command
    const provider = explorerProvider;
    context.subscriptions.push(
        vscode.commands.registerCommand('mailClient.refreshFolders', () => {
            provider.refresh();
        }),
    );

    // Restart auto-refresh when settings change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('mailClient.refreshInterval')) {
                provider.startAutoRefresh();
            }
        }),
    );

    // Auto-connect to accounts on startup
    autoConnect(accountManager, provider, treeView).then(() => {
        provider.startAutoRefresh();
    });

    // Register WebviewPanelSerializers for restoring panels
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer(MessageDetailPanel.viewType, {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                if (state && state.accountId && state.folderPath && state.uid) {
                    MessageDetailPanel.restore(
                        webviewPanel,
                        state.accountId,
                        state.folderPath,
                        state.uid,
                        explorerProvider!,
                        accountManager
                    );
                } else {
                    webviewPanel.dispose();
                }
            }
        })
    );

    context.subscriptions.push({
        dispose: () => {
            explorerProvider?.dispose();
            accountManager.dispose();
        },
    });

    console.log('Mail Client extension activated');
}

/**
 * Automatically connects to all configured accounts.
 */
async function autoConnect(
    accountManager: AccountManager,
    explorerProvider: MailExplorerProvider,
    treeView: vscode.TreeView<import('./providers/mailExplorerProvider').MailTreeItem>,
): Promise<void> {
    const accounts = accountManager.getAccounts();

    for (const account of accounts) {
        try {
            const password = await accountManager.getPassword(account.id);
            if (password) {
                await explorerProvider.connectAccount(account, password);
                // Auto-expand the account's folder subtree
                const accountItems = explorerProvider.getAccountItems();
                const item = accountItems.find(i => i.accountId === account.id);
                if (item) {
                    try {
                        await treeView.reveal(item, { expand: 3 });
                    } catch {
                        // Ignore reveal errors (tree might not be visible yet)
                    }
                    // Auto-open the first folder
                    const folderItems = await explorerProvider.getChildren(item);
                    const firstFolder = folderItems.find(f => f.folderPath);
                    if (firstFolder) {
                        MessageListPanel.showInActive(
                            explorerProvider,
                            accountManager,
                            firstFolder.accountId,
                            firstFolder.folderPath!,
                            firstFolder.label as string,
                        );
                    }
                }
            }
        } catch (error) {
            console.warn(`Failed to auto-connect account "${account.name}":`, error);
        }
    }
}

/**
 * Extension deactivation.
 */
export async function deactivate(): Promise<void> {
    if (explorerProvider) {
        await explorerProvider.disconnectAll();
    }
}

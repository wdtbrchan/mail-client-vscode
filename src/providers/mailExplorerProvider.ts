import * as vscode from 'vscode';
import { AccountManager } from '../services/accountManager';
import { ImapService } from '../services/imapService';
import { IMailAccount } from '../types/account';
import { IMailFolder } from '../types/folder';

/**
 * Tree item types for the Mail Explorer.
 */
type MailTreeItemType = 'account' | 'folder';

/**
 * Represents a single item in the Mail Explorer tree.
 */
export class MailTreeItem extends vscode.TreeItem {
    constructor(
        public readonly itemType: MailTreeItemType,
        public readonly accountId: string,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly folderPath?: string,
        public readonly folder?: IMailFolder,
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;

        if (itemType === 'account') {
            this.iconPath = new vscode.ThemeIcon('mail');
        } else if (itemType === 'folder') {
            this.iconPath = this.getFolderIcon(folder);
            this.command = {
                command: 'mailClient.openFolder',
                title: 'Open Folder',
                arguments: [this],
            };
        }
    }

    private getFolderIcon(folder?: IMailFolder): vscode.ThemeIcon {
        if (!folder?.specialUse) {
            return new vscode.ThemeIcon('folder');
        }

        const iconMap: Record<string, string> = {
            '\\Inbox': 'inbox',
            '\\Sent': 'send',
            '\\Drafts': 'edit',
            '\\Trash': 'trash',
            '\\Junk': 'warning',
            '\\Archive': 'archive',
        };

        const icon = iconMap[folder.specialUse] || 'folder';
        return new vscode.ThemeIcon(icon);
    }
}

/**
 * Data provider for the Mail Explorer tree view.
 * Shows accounts at root level and their IMAP folders as children.
 */
export class MailExplorerProvider implements vscode.TreeDataProvider<MailTreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<MailTreeItem | undefined | null>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** Map of account ID to their IMAP service instances */
    private readonly imapServices = new Map<string, ImapService>();
    /** Cached folder trees per account */
    private readonly folderCache = new Map<string, IMailFolder[]>();

    /** Reference to the tree view for badge updates */
    private treeView?: vscode.TreeView<MailTreeItem>;
    /** Auto-refresh timer */
    private refreshTimer?: ReturnType<typeof setInterval>;

    constructor(
        private readonly accountManager: AccountManager
    ) {
        // Refresh tree when accounts change
        this.accountManager.onAccountsChanged(() => this.refresh());
    }

    /**
     * Sets the tree view reference for badge updates.
     */
    setTreeView(treeView: vscode.TreeView<MailTreeItem>): void {
        this.treeView = treeView;
    }

    /**
     * Starts the auto-refresh timer based on settings.
     */
    startAutoRefresh(): void {
        this.stopAutoRefresh();
        const interval = vscode.workspace.getConfiguration('mailClient').get<number>('refreshInterval', 60);
        if (interval > 0) {
            this.refreshTimer = setInterval(() => this.refresh(), interval * 1000);
        }
    }

    /**
     * Stops the auto-refresh timer.
     */
    stopAutoRefresh(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    /**
     * Refreshes the entire tree or a specific item.
     */
    async refresh(item?: MailTreeItem, forceReconnect = false): Promise<void> {
        if (!item) {
            this.folderCache.clear();
        }

        if (forceReconnect) {
            const tasks: Promise<void>[] = [];
            for (const service of this.imapServices.values()) {
                service.hasConnectionError = false;
                service.lastConnectionError = undefined;
                tasks.push(service.disconnect().catch(() => { }));
            }
            await Promise.all(tasks);
        }

        this._onDidChangeTreeData.fire(item);
    }

    getTreeItem(element: MailTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: MailTreeItem): Promise<MailTreeItem[]> {
        if (!element) {
            return this.getAccountItems();
        }

        if (element.itemType === 'account') {
            return this.getFolderItems(element.accountId);
        }

        if (element.itemType === 'folder' && element.folder?.children) {
            return element.folder.children.map(child =>
                this.createFolderItem(element.accountId, child)
            );
        }

        return [];
    }

    getParent(element: MailTreeItem): MailTreeItem | undefined {
        if (element.itemType === 'account') {
            return undefined;
        }
        // Folder items belong to an account
        const account = this.accountManager.getAccount(element.accountId);
        if (!account) {
            return undefined;
        }
        return new MailTreeItem(
            'account',
            account.id,
            account.name,
            vscode.TreeItemCollapsibleState.Collapsed,
        );
    }

    /**
     * Returns the IMAP service for a given account.
     * Creates one if it doesn't exist yet.
     */
    getImapService(accountId: string): ImapService {
        let service = this.imapServices.get(accountId);
        if (!service) {
            service = new ImapService();
            this.imapServices.set(accountId, service);
        }
        return service;
    }

    /**
     * Connects to an account's IMAP server.
     */
    async connectAccount(account: IMailAccount, password: string): Promise<void> {
        const service = this.getImapService(account.id);
        if (!service.connected) {
            await service.connect(account, password);
        }
    }

    /**
     * Disconnects all IMAP connections.
     */
    async disconnectAll(): Promise<void> {
        for (const service of this.imapServices.values()) {
            if (service.connected) {
                try {
                    await service.disconnect();
                } catch {
                    // Ignore disconnect errors during cleanup
                }
            }
        }
        this.imapServices.clear();
    }

    // ---- Private helpers ----

    getAccountItems(): MailTreeItem[] {
        const accounts = this.accountManager.getAccounts();
        return accounts.map(account =>
            new MailTreeItem(
                'account',
                account.id,
                account.name,
                vscode.TreeItemCollapsibleState.Collapsed,
            )
        );
    }

    private async getFolderItems(accountId: string): Promise<MailTreeItem[]> {
        // Check cache first
        let folders = this.folderCache.get(accountId);
        if (folders) {
            return folders.map(f => this.createFolderItem(accountId, f));
        }

        const service = this.getImapService(accountId);
        
        if (service.hasConnectionError) {
            const item = new MailTreeItem('folder', accountId, `⚠ Connection error`, vscode.TreeItemCollapsibleState.None);
            item.tooltip = service.lastConnectionError || 'Please refresh connection manually';
            return [item];
        }

        if (!service.connected) {
            // Try to connect automatically
            const account = this.accountManager.getAccount(accountId);
            if (!account) {
                return [];
            }

            const password = await this.accountManager.getPassword(accountId);
            if (!password) {
                return [new MailTreeItem('folder', accountId, '⚠ No password configured', vscode.TreeItemCollapsibleState.None)];
            }

            try {
                await service.connect(account, password);
            } catch (error) {
                service.hasConnectionError = true;
                const errorMsg = error instanceof Error ? error.message : 'Connection failed';
                service.lastConnectionError = errorMsg;
                const item = new MailTreeItem('folder', accountId, `⚠ Connection error`, vscode.TreeItemCollapsibleState.None);
                item.tooltip = errorMsg;
                return [item];
            }
        }

        try {
            folders = await service.listFolders();
        } catch (error) {
            service.hasConnectionError = true;
            const errorMsg = error instanceof Error ? error.message : 'Failed to list folders';
            service.lastConnectionError = errorMsg;
            const item = new MailTreeItem('folder', accountId, `⚠ Connection error`, vscode.TreeItemCollapsibleState.None);
            item.tooltip = errorMsg;
            return [item];
        }

        this.folderCache.set(accountId, folders);
        const items = folders.map(f => this.createFolderItem(accountId, f));
        this.updateBadge();
        return items;
    }

    private createFolderItem(accountId: string, folder: IMailFolder): MailTreeItem {
        const hasChildren = folder.children && folder.children.length > 0;

        const item = new MailTreeItem(
            'folder',
            accountId,
            folder.name,
            hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
            folder.path,
            folder,
        );

        if (folder.unseenMessages && folder.unseenMessages > 0) {
            item.description = `${folder.unseenMessages}`;
        }

        return item;
    }

    /**
     * Calculates total unread count across all cached folders and updates the tree view badge.
     */
    private updateBadge(): void {
        if (!this.treeView) {
            return;
        }

        let totalUnseen = 0;
        for (const folders of this.folderCache.values()) {
            totalUnseen += this.countUnseen(folders);
        }

        this.treeView.badge = totalUnseen > 0
            ? { value: totalUnseen, tooltip: `${totalUnseen} nepřečtených zpráv` }
            : undefined;
    }

    private countUnseen(folders: IMailFolder[]): number {
        let count = 0;
        for (const folder of folders) {
            count += folder.unseenMessages ?? 0;
            if (folder.children) {
                count += this.countUnseen(folder.children);
            }
        }
        return count;
    }

    dispose(): void {
        this.stopAutoRefresh();
        this._onDidChangeTreeData.dispose();
        this.disconnectAll();
    }
}

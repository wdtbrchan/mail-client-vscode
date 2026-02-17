import * as vscode from 'vscode';
import { IMailAccount } from '../types/account';

const ACCOUNTS_KEY = 'mailClient.accounts';

/**
 * Manages mail account configurations.
 * Stores account metadata in globalState and passwords in SecretStorage.
 */
export class AccountManager {
    private readonly _onAccountsChanged = new vscode.EventEmitter<void>();
    /** Fires when accounts are added, removed, or updated */
    public readonly onAccountsChanged = this._onAccountsChanged.event;

    constructor(
        private readonly context: vscode.ExtensionContext
    ) {}

    /**
     * Returns all stored mail accounts.
     */
    getAccounts(): IMailAccount[] {
        return this.context.globalState.get<IMailAccount[]>(ACCOUNTS_KEY, []);
    }

    /**
     * Returns a single account by ID, or undefined if not found.
     */
    getAccount(id: string): IMailAccount | undefined {
        return this.getAccounts().find(a => a.id === id);
    }

    /**
     * Adds a new account and stores its password securely.
     */
    async addAccount(account: IMailAccount, password: string, smtpPassword?: string): Promise<void> {
        const accounts = this.getAccounts();
        accounts.push(account);
        await this.context.globalState.update(ACCOUNTS_KEY, accounts);
        await this.context.secrets.store(this.getPasswordKey(account.id), password);
        if (smtpPassword !== undefined) {
            await this.context.secrets.store(this.getSmtpPasswordKey(account.id), smtpPassword);
        }
        this._onAccountsChanged.fire();
    }

    /**
     * Updates an existing account. Optionally updates the password.
     */
    async updateAccount(account: IMailAccount, password?: string, smtpPassword?: string): Promise<void> {
        const accounts = this.getAccounts();
        const index = accounts.findIndex(a => a.id === account.id);
        if (index === -1) {
            throw new Error(`Account not found: ${account.id}`);
        }
        accounts[index] = account;
        await this.context.globalState.update(ACCOUNTS_KEY, accounts);
        if (password !== undefined) {
            await this.context.secrets.store(this.getPasswordKey(account.id), password);
        }
        if (smtpPassword !== undefined) {
            await this.context.secrets.store(this.getSmtpPasswordKey(account.id), smtpPassword);
        }
        this._onAccountsChanged.fire();
    }

    /**
     * Removes an account and its stored password.
     */
    async removeAccount(id: string): Promise<void> {
        const accounts = this.getAccounts().filter(a => a.id !== id);
        await this.context.globalState.update(ACCOUNTS_KEY, accounts);
        await this.context.secrets.delete(this.getPasswordKey(id));
        await this.context.secrets.delete(this.getSmtpPasswordKey(id));
        this._onAccountsChanged.fire();
    }

    /**
     * Retrieves the stored IMAP password for an account.
     */
    async getPassword(accountId: string): Promise<string | undefined> {
        return this.context.secrets.get(this.getPasswordKey(accountId));
    }

    /**
     * Retrieves the stored SMTP password for an account.
     */
    async getSmtpPassword(accountId: string): Promise<string | undefined> {
        return this.context.secrets.get(this.getSmtpPasswordKey(accountId));
    }

    /**
     * Generates a unique ID for a new account.
     */
    generateId(): string {
        return `account-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    private getPasswordKey(accountId: string): string {
        return `mailClient.password.${accountId}`;
    }

    private getSmtpPasswordKey(accountId: string): string {
        return `mailClient.smtpPassword.${accountId}`;
    }

    dispose(): void {
        this._onAccountsChanged.dispose();
    }
}

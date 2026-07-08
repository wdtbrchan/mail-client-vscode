import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import { AddressInfo } from 'net';
import * as msal from '@azure/msal-node';
import { IMailAccount } from '../types/account';

export type OAuthProvider = 'microsoft';

/** Result of an interactive sign-in. */
export interface IOAuthSignInResult {
    /** Account email address, if it could be determined. */
    email?: string;
}

interface ICachedToken {
    accessToken: string;
    /** Epoch milliseconds when the token expires. */
    expiresAt: number;
}

/** Microsoft delegated scopes for Outlook/Exchange IMAP + SMTP (NOT Graph). */
const MS_SCOPES = [
    'openid',
    'profile',
    'offline_access',
    'https://outlook.office.com/IMAP.AccessAsUser.All',
    'https://outlook.office.com/SMTP.Send',
];

/** SecretStorage key prefix for the MSAL token cache. */
const MSAL_CACHE_KEY_PREFIX = 'mailClient.msalCache.';

/** Refresh access tokens this many ms before their real expiry. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Handles OAuth2 (XOAUTH2) authentication for Microsoft (Office 365 / Outlook).
 *
 * The app is a public client secured by PKCE with no client secret at all
 * (`@azure/msal-node` `PublicClientApplication` with a SecretStorage-backed token
 * cache; silent refresh handled by MSAL). Client ID + tenant come from settings.
 *
 * Gmail is intentionally NOT supported via OAuth2: Google's `https://mail.google.com/`
 * is a restricted scope whose public distribution requires a paid annual CASA
 * security assessment. Gmail users authenticate with an App Password (basic auth)
 * instead — see the README.
 */
export class OAuthService {
    private static instance: OAuthService | undefined;

    /** In-memory access-token cache keyed by account id. */
    private readonly tokenCache = new Map<string, ICachedToken>();

    private constructor(private readonly context: vscode.ExtensionContext) {}

    /** Initializes the singleton. Call once during extension activation. */
    static init(context: vscode.ExtensionContext): OAuthService {
        OAuthService.instance = new OAuthService(context);
        return OAuthService.instance;
    }

    static getInstance(): OAuthService {
        if (!OAuthService.instance) {
            throw new Error('OAuthService not initialized.');
        }
        return OAuthService.instance;
    }

    private msalCacheKey(accountId: string): string {
        return `${MSAL_CACHE_KEY_PREFIX}${accountId}`;
    }

    /** Removes all stored tokens (MSAL cache) for an account. */
    async clearTokens(accountId: string): Promise<void> {
        this.tokenCache.delete(accountId);
        await this.context.secrets.delete(this.msalCacheKey(accountId));
    }

    // ---- Access tokens ----

    /**
     * Returns a valid access token for an OAuth2 account, refreshing it as needed.
     * Throws if the account has not been signed in.
     */
    async getAccessToken(account: IMailAccount): Promise<string> {
        if (account.authType !== 'oauth2') {
            throw new Error('Account is not configured for OAuth2.');
        }

        const cached = this.tokenCache.get(account.id);
        if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
            return cached.accessToken;
        }

        return this.getAccessTokenMicrosoft(account);
    }

    // ---- Sign-in ----

    /**
     * Runs the interactive sign-in flow in the system browser, persists the
     * resulting tokens for the account, and returns the account email if known.
     * `provider` is always `'microsoft'`; the parameter is kept for API stability.
     */
    async signIn(_provider: OAuthProvider, accountId: string): Promise<IOAuthSignInResult> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Signing in to Microsoft…',
                cancellable: true,
            },
            (_progress, cancelToken) => this.signInMicrosoft(accountId, cancelToken),
        );
    }

    // ---- Microsoft (MSAL) ----

    /** Builds an MSAL public client bound to an account's SecretStorage cache. */
    private createMsalClient(accountId: string): msal.PublicClientApplication {
        const cfg = vscode.workspace.getConfiguration('mailClient.oauth');
        const clientId = (cfg.get<string>('microsoftClientId') || '').trim();
        const tenant = (cfg.get<string>('microsoftTenant') || 'common').trim() || 'common';
        if (!clientId) {
            throw new Error(
                'Microsoft OAuth client ID is not set. Configure "mailClient.oauth.microsoftClientId".',
            );
        }

        const cacheKey = this.msalCacheKey(accountId);
        const cachePlugin: msal.ICachePlugin = {
            beforeCacheAccess: async (cacheContext) => {
                const cached = await this.context.secrets.get(cacheKey);
                if (cached) {
                    cacheContext.tokenCache.deserialize(cached);
                }
            },
            afterCacheAccess: async (cacheContext) => {
                if (cacheContext.cacheHasChanged) {
                    await this.context.secrets.store(cacheKey, cacheContext.tokenCache.serialize());
                }
            },
        };

        return new msal.PublicClientApplication({
            auth: {
                clientId,
                authority: `https://login.microsoftonline.com/${tenant}`,
            },
            cache: { cachePlugin },
        });
    }

    private async getAccessTokenMicrosoft(account: IMailAccount): Promise<string> {
        const pca = this.createMsalClient(account.id);
        const accounts = await pca.getTokenCache().getAllAccounts();
        if (accounts.length > 0) {
            try {
                const silent = await pca.acquireTokenSilent({
                    account: accounts[0],
                    scopes: MS_SCOPES,
                });
                if (silent?.accessToken) {
                    this.cacheResult(account.id, silent.accessToken, silent.expiresOn);
                    return silent.accessToken;
                }
            } catch {
                // Falls through to the "not signed in" error – e.g. expired/revoked
                // refresh token, changed consent, or new conditional-access policy.
            }
        }
        throw new Error(
            `Account "${account.name}" is not signed in. Open account settings and sign in again.`,
        );
    }

    private async signInMicrosoft(
        accountId: string,
        cancelToken: vscode.CancellationToken,
    ): Promise<IOAuthSignInResult> {
        const pca = this.createMsalClient(accountId);
        const cryptoProvider = new msal.CryptoProvider();
        const pkce = await cryptoProvider.generatePkceCodes();
        const state = crypto.randomBytes(16).toString('hex');

        const { code, redirectUri } = await this.runLoopbackAuth(
            'localhost',
            state,
            cancelToken,
            (redirect) =>
                pca.getAuthCodeUrl({
                    scopes: MS_SCOPES,
                    redirectUri: redirect,
                    responseMode: 'query',
                    state,
                    codeChallenge: pkce.challenge,
                    codeChallengeMethod: 'S256',
                }),
        );

        const result = await pca.acquireTokenByCode({
            code,
            scopes: MS_SCOPES,
            redirectUri,
            codeVerifier: pkce.verifier,
        });
        if (!result?.accessToken) {
            throw new Error('Failed to acquire a Microsoft access token.');
        }

        // MSAL persisted its cache (incl. refresh token) via the cache plugin.
        this.cacheResult(accountId, result.accessToken, result.expiresOn);
        return { email: result.account?.username };
    }

    // ---- Shared helpers ----

    /**
     * Starts a temporary loopback HTTP server, opens the authorize URL in the
     * system browser, and resolves with the returned authorization code.
     * @param buildAuthUrl Builds the authorize URL given the resolved redirect URI.
     */
    private runLoopbackAuth(
        redirectHost: string,
        state: string,
        cancelToken: vscode.CancellationToken,
        buildAuthUrl: (redirectUri: string) => string | Promise<string>,
    ): Promise<{ code: string; redirectUri: string }> {
        return new Promise((resolve, reject) => {
            let redirectUri = '';

            const server = http.createServer((req, res) => {
                try {
                    const reqUrl = new URL(req.url || '/', `http://${redirectHost}`);
                    const code = reqUrl.searchParams.get('code');
                    const returnedState = reqUrl.searchParams.get('state');
                    const error = reqUrl.searchParams.get('error');

                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(
                        '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">' +
                            '<h2>Authentication complete</h2>' +
                            '<p>You can close this tab and return to VS Code.</p>' +
                            '</body></html>',
                    );

                    cleanup();

                    if (error) {
                        reject(new Error(`Authorization error: ${error}`));
                    } else if (!code) {
                        reject(new Error('No authorization code received.'));
                    } else if (returnedState !== state) {
                        reject(new Error('State mismatch (possible CSRF).'));
                    } else {
                        resolve({ code, redirectUri });
                    }
                } catch (e) {
                    cleanup();
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            });

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Sign-in timed out.'));
            }, 180_000);

            const cancelSub = cancelToken.onCancellationRequested(() => {
                cleanup();
                reject(new Error('Sign-in cancelled.'));
            });

            const cleanup = () => {
                clearTimeout(timeout);
                cancelSub.dispose();
                server.close();
            };

            server.on('error', (err) => {
                cleanup();
                reject(err);
            });

            server.listen(0, redirectHost, async () => {
                try {
                    const port = (server.address() as AddressInfo).port;
                    redirectUri = `http://${redirectHost}:${port}`;
                    const authUrl = await buildAuthUrl(redirectUri);
                    await vscode.env.openExternal(vscode.Uri.parse(authUrl));
                } catch (e) {
                    cleanup();
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            });
        });
    }

    /** Caches an access token with its expiry. */
    private cacheResult(accountId: string, accessToken: string, expiresOn: Date | null | undefined): void {
        const expiresAt = expiresOn ? expiresOn.getTime() : Date.now() + 3600_000;
        this.tokenCache.set(accountId, { accessToken, expiresAt });
    }
}

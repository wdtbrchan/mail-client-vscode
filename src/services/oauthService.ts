import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import { AddressInfo } from 'net';
import { IMailAccount } from '../types/account';

export type OAuthProvider = 'microsoft' | 'google';

/** Result of an interactive sign-in. */
export interface IOAuthSignInResult {
    refreshToken: string;
    accessToken: string;
    /** Account email address extracted from the id_token, if available. */
    email?: string;
    expiresAt: number;
}

interface IProviderConfig {
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string;
    /** Loopback redirect host – provider-specific to match registered URI. */
    redirectHost: string;
    /**
     * OAuth client id. This is a *public* identifier of a desktop/native (public)
     * client, NOT a secret. No client secret is ever used or stored – both
     * providers are configured as public clients secured by PKCE.
     */
    clientId: string;
    /** Extra params appended to the authorize URL. */
    extraAuthParams?: Record<string, string>;
}

interface ITokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    error?: string;
    error_description?: string;
}

interface ICachedToken {
    accessToken: string;
    /** Epoch milliseconds when the token expires. */
    expiresAt: number;
}

const REFRESH_KEY_PREFIX = 'mailClient.oauthRefresh.';
/** Refresh access tokens this many ms before their real expiry. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Handles OAuth2 (XOAUTH2) authentication for Microsoft (Office 365) and Google
 * (Gmail). Uses the Authorization Code flow with PKCE and a loopback redirect
 * (RFC 8252). Refresh tokens live in SecretStorage; access tokens are cached in
 * memory and refreshed on demand.
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

    private getRefreshKey(accountId: string): string {
        return `${REFRESH_KEY_PREFIX}${accountId}`;
    }

    /** Stores a refresh token for an account. */
    async storeRefreshToken(accountId: string, refreshToken: string): Promise<void> {
        await this.context.secrets.store(this.getRefreshKey(accountId), refreshToken);
    }

    /** Removes the stored refresh token and cached access token for an account. */
    async clearTokens(accountId: string): Promise<void> {
        this.tokenCache.delete(accountId);
        await this.context.secrets.delete(this.getRefreshKey(accountId));
    }

    /**
     * Returns a valid access token for an OAuth2 account, refreshing it via the
     * stored refresh token when needed. Throws if the account has not signed in.
     */
    async getAccessToken(account: IMailAccount): Promise<string> {
        if (account.authType !== 'oauth2' || !account.oauthProvider) {
            throw new Error('Account is not configured for OAuth2.');
        }

        const cached = this.tokenCache.get(account.id);
        if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
            return cached.accessToken;
        }

        const refreshToken = await this.context.secrets.get(this.getRefreshKey(account.id));
        if (!refreshToken) {
            throw new Error(
                `Account "${account.name}" is not signed in. Open account settings and sign in again.`,
            );
        }

        return this.refreshAccessToken(account.id, account.oauthProvider, refreshToken);
    }

    /**
     * Exchanges a refresh token for a fresh access token, caches it, and persists
     * any rotated refresh token (Microsoft rotates refresh tokens).
     */
    private async refreshAccessToken(
        accountId: string,
        provider: OAuthProvider,
        refreshToken: string,
    ): Promise<string> {
        const config = this.getProviderConfig(provider);

        const body: Record<string, string> = {
            client_id: config.clientId,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            scope: config.scopes,
        };

        const token = await this.postToken(config.tokenUrl, body);
        const expiresAt = Date.now() + (token.expires_in ?? 3600) * 1000;
        this.tokenCache.set(accountId, { accessToken: token.access_token, expiresAt });

        // Persist rotated refresh token, if a new one was issued.
        if (token.refresh_token && token.refresh_token !== refreshToken) {
            await this.storeRefreshToken(accountId, token.refresh_token);
        }

        return token.access_token;
    }

    /**
     * Runs the interactive sign-in flow in the system browser and returns the
     * resulting tokens. Does not persist anything – caller decides where to store
     * the refresh token (the access token is also cached here under accountId).
     */
    async signIn(provider: OAuthProvider, accountId: string): Promise<IOAuthSignInResult> {
        const config = this.getProviderConfig(provider);

        const { verifier, challenge } = this.generatePkce();
        const state = crypto.randomBytes(16).toString('hex');

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Signing in to ${provider === 'microsoft' ? 'Microsoft' : 'Google'}…`,
                cancellable: true,
            },
            async (_progress, cancelToken) => {
                const { code, redirectUri } = await this.runLoopbackAuth(
                    config,
                    challenge,
                    state,
                    cancelToken,
                );

                const body: Record<string, string> = {
                    client_id: config.clientId,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: redirectUri,
                    code_verifier: verifier,
                };

                const token = await this.postToken(config.tokenUrl, body);
                if (!token.refresh_token) {
                    throw new Error(
                        'No refresh token returned by the provider. Ensure offline access is granted.',
                    );
                }

                const expiresAt = Date.now() + (token.expires_in ?? 3600) * 1000;
                this.tokenCache.set(accountId, {
                    accessToken: token.access_token,
                    expiresAt,
                });

                return {
                    refreshToken: token.refresh_token,
                    accessToken: token.access_token,
                    email: this.extractEmail(token.id_token),
                    expiresAt,
                };
            },
        );
    }

    /**
     * Opens the authorize URL in the browser and waits for the loopback redirect
     * carrying the authorization code.
     */
    private runLoopbackAuth(
        config: IProviderConfig,
        challenge: string,
        state: string,
        cancelToken: vscode.CancellationToken,
    ): Promise<{ code: string; redirectUri: string }> {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                try {
                    const reqUrl = new URL(req.url || '/', `http://${config.redirectHost}`);
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

            let redirectUri = '';
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

            server.listen(0, config.redirectHost, () => {
                const port = (server.address() as AddressInfo).port;
                redirectUri = `http://${config.redirectHost}:${port}`;

                const authUrl = new URL(config.authorizeUrl);
                authUrl.searchParams.set('client_id', config.clientId);
                authUrl.searchParams.set('response_type', 'code');
                authUrl.searchParams.set('redirect_uri', redirectUri);
                authUrl.searchParams.set('scope', config.scopes);
                authUrl.searchParams.set('state', state);
                authUrl.searchParams.set('code_challenge', challenge);
                authUrl.searchParams.set('code_challenge_method', 'S256');
                for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) {
                    authUrl.searchParams.set(k, v);
                }

                vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));
            });
        });
    }

    /** Performs an x-www-form-urlencoded POST to a token endpoint. */
    private async postToken(
        tokenUrl: string,
        body: Record<string, string>,
    ): Promise<ITokenResponse> {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(body).toString(),
        });

        const data = (await response.json()) as ITokenResponse;
        if (!response.ok || data.error || !data.access_token) {
            const detail = data.error_description || data.error || `HTTP ${response.status}`;
            throw new Error(`Token request failed: ${detail}`);
        }
        return data;
    }

    /** Builds the provider config, merging in client credentials from settings. */
    private getProviderConfig(provider: OAuthProvider): IProviderConfig {
        const cfg = vscode.workspace.getConfiguration('mailClient.oauth');

        if (provider === 'microsoft') {
            const clientId = (cfg.get<string>('microsoftClientId') || '').trim();
            const tenant = (cfg.get<string>('microsoftTenant') || 'common').trim() || 'common';
            if (!clientId) {
                throw new Error(
                    'Microsoft OAuth client ID is not set. Configure "mailClient.oauth.microsoftClientId".',
                );
            }
            return {
                authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
                tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
                scopes:
                    'openid email offline_access ' +
                    'https://outlook.office.com/IMAP.AccessAsUser.All ' +
                    'https://outlook.office.com/SMTP.Send',
                redirectHost: 'localhost',
                clientId,
            };
        }

        // Google – public "Desktop app" client, PKCE only, no client secret.
        const clientId = (cfg.get<string>('googleClientId') || '').trim();
        if (!clientId) {
            throw new Error(
                'Google OAuth client ID is not set. Configure "mailClient.oauth.googleClientId".',
            );
        }
        return {
            authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            scopes: 'openid email https://mail.google.com/',
            redirectHost: '127.0.0.1',
            clientId,
            extraAuthParams: { access_type: 'offline', prompt: 'consent' },
        };
    }

    /** Generates a PKCE verifier/challenge pair. */
    private generatePkce(): { verifier: string; challenge: string } {
        const verifier = crypto.randomBytes(32).toString('base64url');
        const challenge = crypto
            .createHash('sha256')
            .update(verifier)
            .digest('base64url');
        return { verifier, challenge };
    }

    /** Extracts the email/username claim from an id_token JWT, if present. */
    private extractEmail(idToken?: string): string | undefined {
        if (!idToken) {
            return undefined;
        }
        try {
            const payload = idToken.split('.')[1];
            const json = Buffer.from(payload, 'base64url').toString('utf8');
            const claims = JSON.parse(json);
            return claims.email || claims.preferred_username || claims.upn || undefined;
        } catch {
            return undefined;
        }
    }
}

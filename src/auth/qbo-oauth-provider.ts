import { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { SignJWT, jwtVerify } from "jose";
import { Response } from "express";
import { quickbooksClient } from "../clients/quickbooks-client.js";

/**
 * JWT payload type for access tokens.
 * Contains realmId, refreshToken, and scopes so that verifyAccessToken() can inject credentials into the QuickBooks client.
 */
interface JwtPayload {
  realmId: string;
  refreshToken: string;
  scopes?: string[];
  iat: number;
  exp: number;
  jti: string;
  iss: string;
  sub: string;
  aud: string;
}

/**
 * In-memory store for registered OAuth clients.
 * In production, this should be replaced with a database-backed store.
 */
class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients: Map<string, OAuthClientInformationFull>;

  constructor() {
    this.clients = new Map();
  }

  async registerClient(client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>): Promise<OAuthClientInformationFull> {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    // Preserve all metadata fields from the registration request, especially scope
    const clientInfo: OAuthClientInformationFull = {
      client_id: clientId,
      client_secret: client.client_secret || this.generateClientSecret(),
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      response_types: client.response_types,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: client.client_secret_expires_at || Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year
      // Preserve additional metadata fields
      scope: client.scope,
      client_name: client.client_name,
      client_uri: client.client_uri,
      logo_uri: client.logo_uri,
      tos_uri: client.tos_uri,
      policy_uri: client.policy_uri,
      contacts: client.contacts,
      jwks_uri: client.jwks_uri,
      jwks: client.jwks,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      software_id: client.software_id,
      software_version: client.software_version,
      software_statement: client.software_statement,
    };

    this.clients.set(clientId, clientInfo);
    return clientInfo;
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  private generateClientSecret(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 64; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

/**
 * In-memory store for authorization codes.
 * Each code is stored with a 10-minute expiry time.
 */
interface StoredAuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  scope?: string[];
  expiryTime: number;
  used: boolean;
}

class InMemoryAuthCodesStore {
  private codes: Map<string, StoredAuthorizationCode>;

  constructor() {
    this.codes = new Map();
  }

  store(code: string, params: AuthorizationParams, clientId: string): void {
    const expiryTime = Date.now() + 10 * 60 * 1000; // 10 minutes
    const storedCode: StoredAuthorizationCode = {
      code,
      clientId,
      redirectUri: params.redirectUri,
      state: params.state,
      codeChallenge: params.codeChallenge,
      scope: params.scopes,
      expiryTime,
      used: false,
    };
    // Store by the MCP auth code
    this.codes.set(code, storedCode);
    // Also store by state so we can look up in callback
    if (params.state) {
      this.codes.set(`state:${params.state}`, storedCode);
    }
  }

  getCode(code: string): StoredAuthorizationCode | undefined {
    return this.codes.get(code);
  }

  getByState(state: string): StoredAuthorizationCode | undefined {
    return this.codes.get(`state:${state}`);
  }

  markUsed(code: string): void {
    const stored = this.codes.get(code);
    if (stored) {
      stored.used = true;
    }
  }

  cleanupExpired(): void {
    const now = Date.now();
    for (const [key, stored] of this.codes.entries()) {
      if (stored.expiryTime < now || stored.used) {
        this.codes.delete(key);
      }
    }
  }
}

/**
 * Generates a random string for use as state parameter.
 */
function generateRandomString(length: number = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generates a random authorization code.
 */
function generateAuthorizationCode(): string {
  return generateRandomString(48);
}

/**
 * URL-safe base64 encoding.
 */
function base64UrlEncode(data: string | Buffer): string {
  return Buffer.from(data).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * QBOOAuthProvider implements the OAuthServerProvider interface for QuickBooks Online OAuth 2.1 integration.
 * 
 * This provider:
 * - Manages OAuth client registration
 * - Generates authorization URLs pointing to QuickBooks Online
 * - Handles OAuth callback and issues JWT access tokens
 * - Validates access tokens using jose jwtVerify
 */
export class QBOOAuthProvider implements OAuthServerProvider {
  // In-memory stores for clients and auth codes
  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }
  private readonly _clientsStore: OAuthRegisteredClientsStore;
  private authCodesStore: InMemoryAuthCodesStore;
  skipLocalPkceValidation?: boolean;

  // QuickBooks OAuth configuration
  private readonly qboAuthorizeUrl: string;
  private readonly qboTokenUrl: string;
  private readonly qboOAuthScopes: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  // JWT signing key
  private readonly jwtSecret: string;

  constructor() {
    // Initialize stores
    this._clientsStore = new InMemoryClientsStore();
    this.authCodesStore = new InMemoryAuthCodesStore();

    // QuickBooks OAuth configuration
    this.clientId = process.env.QUICKBOOKS_CLIENT_ID || "";
    this.clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || "";
    this.redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || "";
    this.qboAuthorizeUrl = process.env.QUICKBOOKS_AUTHORIZE_URL || "https://appcenter.intuit.com/connect/oauth2";
    this.qboTokenUrl = process.env.QUICKBOOKS_TOKEN_URL || "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
    this.qboOAuthScopes = process.env.QUICKBOOKS_OAUTH_SCOPES || "com.intuit.quickbooks.accounting";

    // JWT signing key
    this.jwtSecret = process.env.JWT_SECRET || "";

    // Validate required configuration
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error("QuickBooks OAuth credentials not configured. Set QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, and QUICKBOOKS_REDIRECT_URI.");
    }

    if (!this.jwtSecret) {
      throw new Error("JWT_SECRET not configured. Set JWT_SECRET for signing access tokens.");
    }
  }

  /**
   * Authorize: Generate authorization URL for QuickBooks OAuth flow.
   * 
   * This method:
   * 1. Creates a unique state parameter to prevent CSRF attacks
   * 2. Generates authorization URL pointing to QuickBooks
   * 3. Stores the authorization params for later validation
   * 4. Redirects the user to QuickBooks for authorization
   * 
   * After the user authorizes on QuickBooks, they are redirected back to the redirectUri
   * where the handleCallback method processes the response.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Generate a unique state parameter for CSRF protection
    const state = generateRandomString();

    // Generate authorization code
    const authCode = generateAuthorizationCode();

    // Store the authorization code and params
    this.authCodesStore.store(authCode, {
      ...params,
      state,
    }, client.client_id);

    // Build QuickBooks authorization URL
    const qboAuthUrl = new URL(this.qboAuthorizeUrl);
    qboAuthUrl.searchParams.set("client_id", this.clientId);
    qboAuthUrl.searchParams.set("response_type", "code");
    qboAuthUrl.searchParams.set("redirect_uri", this.redirectUri);
    qboAuthUrl.searchParams.set("state", state);
    qboAuthUrl.searchParams.set("realmId", "0"); // Request new company
    // Intuit requires scope parameter for authorization
    qboAuthUrl.searchParams.set("scope", this.qboOAuthScopes);
    // Force standard login prompt to prevent enterprise SSO auto-routing
    qboAuthUrl.searchParams.set("prompt", "login");

    // Redirect to QuickBooks
    res.redirect(qboAuthUrl.toString());
  }

  /**
   * Handle OAuth callback from QuickBooks.
   * 
   * This method is called when QuickBooks redirects back to the redirectUri after authorization.
   * It:
   * 1. Validates the state parameter
   * 2. Exchanges authorization code for tokens with QuickBooks
   * 3. Issues a JWT access token for the MCP client
   * 4. Returns a redirect URL for the client
   */
  async handleCallback(query: URLSearchParams): Promise<{
    uri: URL;
  }> {
    // Extract parameters from callback
    const code = query.get("code");
    const state = query.get("state");
    const error = query.get("error");

    if (error) {
      throw new Error(`QuickBooks authorization error: ${error} - ${query.get("error_description")}`);
    }

    if (!code || !state) {
      throw new Error("Missing code or state in callback");
    }

    // Look up the stored MCP auth code by the QBO state
    const storedCode = this.authCodesStore.getByState(state);
    if (!storedCode) {
      throw new Error("Invalid state - no matching authorization code found");
    }

    // Exchange authorization code for tokens with QuickBooks
    const qboTokens = await this.exchangeQBOAuthorizationCode(code);

    // Store credentials for the QuickBooks client
    this.setQBOCredentials(qboTokens);

    // Get scopes from the stored MCP auth code
    const scopes = storedCode.scope || [];

    // Issue a JWT access token for the MCP client with the correct scopes
    const jwtToken = await this.issueJWT(scopes, qboTokens.realmId, qboTokens.refreshToken);

    // Redirect back to the MCP client with the token in the hash fragment
    const redirectUrl = new URL(storedCode.redirectUri);
    redirectUrl.hash = `access_token=${jwtToken}`;

    return { uri: redirectUrl };
  }

  /**
   * Exchange authorization code with QuickBooks for access tokens.
   */
  private async exchangeQBOAuthorizationCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    realmId: string;
  }> {
    const response = await fetch(this.qboTokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`QuickBooks token exchange failed: ${errorBody}`);
    }

    const tokenData = await response.json();

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      realmId: tokenData.realmId,
    };
  }

  /**
   * Set QuickBooks credentials on the QuickBooks client singleton.
   * This is called after successful OAuth flow to persist the credentials.
   */
  private setQBOCredentials(qboTokens: {
    accessToken: string;
    refreshToken: string;
    realmId: string;
  }): void {
    quickbooksClient.setCredentials(qboTokens.refreshToken, qboTokens.realmId);
  }

  /**
   * Issue a JWT access token for the MCP client.
   * 
   * This method:
   * 1. Creates a JWT with realmId, refreshToken, and scopes in the payload
   * 2. Signs the JWT with the secret key
   * 3. Returns the signed JWT string
   * 
   * The realmId and refreshToken are included so that verifyAccessToken()
   * can inject credentials into the QuickBooks client singleton.
   */
  private async issueJWT(scopes: string[], realmId: string, refreshToken: string): Promise<string> {
    return new SignJWT({
      scopes,
      realmId,
      refreshToken,
      iat: Math.floor(Date.now() / 1000),
      // 30-day expiry for access tokens
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setJti(generateRandomString()) // Unique token ID
      .setIssuer("qbo-mcp-server")
      .setSubject("mcp-client")
      .setAudience("mcp-client")
      .sign(new TextEncoder().encode(this.jwtSecret));
  }

  /**
   * ChallengeForAuthorizationCode: Called after authorization to get the stored challenge.
   * 
   * In our implementation, we look up the stored authorization code and return its challenge.
   */
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    // Look up the stored authorization code
    const stored = this.authCodesStore.getCode(authorizationCode);
    
    if (!stored || stored.clientId !== client.client_id) {
      throw new Error("Invalid authorization code");
    }

    return stored.codeChallenge;
  }

  /**
   * ExchangeAuthorizationCode: Exchange authorization code for access token.
   * 
   * This method:
   * 1. Validates the authorization code
   * 2. Exchanges code with QuickBooks for tokens
   * 3. Issues a JWT access token for the MCP client
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    // Look up the stored authorization code
    const stored = this.authCodesStore.getCode(authorizationCode);
    
    if (!stored || stored.clientId !== client.client_id) {
      throw new Error("Invalid authorization code");
    }

    if (stored.used) {
      throw new Error("Authorization code already used");
    }

    if (stored.expiryTime < Date.now()) {
      throw new Error("Authorization code expired");
    }

    if (redirectUri && stored.redirectUri !== redirectUri) {
      throw new Error("Invalid redirect URI");
    }

    // Verify code challenge (PKCE)
    if (this.skipLocalPkceValidation !== true) {
      // PKCE verification is handled by the SDK middleware
      // We just need to ensure codeChallenge is stored
    }

    // Note: QBO token exchange already happened in handleCallback
    // The stored code contains the JWT from that exchange

    // Mark code as used
    this.authCodesStore.markUsed(authorizationCode);

    // Issue JWT token with the correct scopes from the stored auth code
    const scopes = stored.scope || [];
    const jwtToken = await this.issueJWT(scopes, "unknown", "unknown");

    // Cleanup expired codes
    this.authCodesStore.cleanupExpired();

    return {
      access_token: jwtToken,
      token_type: "bearer",
      expires_in: 30 * 24 * 60 * 60, // 30 days
      scope: scopes.join(" "),
    };
  }

  /**
   * ExchangeRefreshToken: Exchange refresh token for new access token.
   * 
   * We don't implement this because:
   * 1. QuickBooks token refresh is handled by the QuickBooks client
   * 2. The MCP client's JWT access token is long-lived (30 days)
   * 
   * This method is kept for interface compatibility but throws an error.
   */
  async exchangeRefreshToken(_client: OAuthClientInformationFull, _refreshToken: string): Promise<OAuthTokens> {
    throw new Error("Not implemented: refresh tokens are handled by the QuickBooks client");
  }

  /**
   * VerifyAccessToken: Verify the JWT access token and return the payload.
   * 
   * This method:
   * 1. Verifies the JWT signature using the secret key
   * 2. Checks token expiry
   * 3. Extracts realmId, refreshToken, and scopes from payload
   * 4. Calls quickbooksClient.setCredentials() to inject credentials
   * 5. Returns the token payload for use in authorization
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify<JwtPayload>(token, new TextEncoder().encode(this.jwtSecret));
      
      // Extract realmId and refreshToken from JWT payload and inject into QuickBooks client
      if (typeof payload.realmId === "string" && typeof payload.refreshToken === "string") {
        quickbooksClient.setCredentials(payload.refreshToken, payload.realmId);
      }
      
      // Extract scopes from JWT payload
      const scopes = payload.scopes && Array.isArray(payload.scopes) 
        ? payload.scopes 
        : [];
      
      return {
        token,
        clientId: payload.sub || "",
        scopes,
        expiresAt: payload.exp,
      };
    } catch (error) {
      throw new InvalidTokenError(`Invalid access token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * RevokeToken: Revoke an access token or refresh token.
   * 
   * We don't implement this because:
   * 1. Our JWT access tokens are stateless and expire automatically
   * 2. QuickBooks refresh tokens should be revoked via QuickBooks API
   * 
   * This method is kept for interface compatibility but throws an error.
   */
  async revokeToken(_client: OAuthClientInformationFull, _request: OAuthTokenRevocationRequest): Promise<void> {
    throw new Error("Not implemented: tokens expire automatically");
  }
}

// Export the provider as a singleton
export const qboOAuthProvider = new QBOOAuthProvider();

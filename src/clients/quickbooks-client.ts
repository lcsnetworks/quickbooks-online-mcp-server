import dotenv from "dotenv";
import QuickBooks from "node-quickbooks";
import OAuthClient from "intuit-oauth";

dotenv.config();
const client_id = process.env.QUICKBOOKS_CLIENT_ID;
const client_secret = process.env.QUICKBOOKS_CLIENT_SECRET;
const refresh_token = process.env.QUICKBOOKS_REFRESH_TOKEN;
const realm_id = process.env.QUICKBOOKS_REALM_ID;
const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
const redirect_uri = process.env.QUICKBOOKS_REDIRECT_URI || 'http://localhost:8000/callback';

// Only throw error if client_id or client_secret is missing
if (!client_id || !client_secret || !redirect_uri) {
  throw Error("Client ID, Client Secret and Redirect URI must be set in environment variables");
}

class QuickbooksClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private refreshToken?: string;
  private realmId?: string;
  private readonly environment: string;
  private accessToken?: string;
  private accessTokenExpiry?: Date;
  private quickbooksInstance?: QuickBooks;
  private oauthClient: OAuthClient;
  private isAuthenticating: boolean = false;
  private redirectUri: string;

  constructor(config: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    realmId?: string;
    environment: string;
    redirectUri: string;
  }) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
    this.realmId = config.realmId;
    this.environment = config.environment;
    this.redirectUri = config.redirectUri;
    this.oauthClient = new OAuthClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      environment: this.environment,
      redirectUri: this.redirectUri,
    });
  }

  setCredentials(refreshToken: string, realmId: string): void {
    this.refreshToken = refreshToken;
    this.realmId = realmId;
    // Reset cached tokens to force refresh on next call
    this.accessToken = undefined;
    this.accessTokenExpiry = undefined;
    this.quickbooksInstance = undefined;
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('QBO credentials not set — call setCredentials() with refreshToken and realmId first');
    }

    try {
      const authResponse = await this.oauthClient.refreshUsingToken(this.refreshToken);
      
      this.accessToken = authResponse.token.access_token;
      
      // Hardening: Capture rotated refresh token if Intuit issues a new one
      // Per Intuit docs, apps must persist the latest refresh token returned from the refresh endpoint
      if (authResponse.token.refresh_token && authResponse.token.refresh_token !== this.refreshToken) {
        this.refreshToken = authResponse.token.refresh_token;
        console.log('Refresh token rotated by QuickBooks - latest token persisted');
      }
      
      // Calculate expiry time
      const expiresIn = authResponse.token.expires_in || 3600; // Default to 1 hour
      this.accessTokenExpiry = new Date(Date.now() + expiresIn * 1000);
      
      return {
        access_token: this.accessToken,
        expires_in: expiresIn,
      };
    } catch (error: any) {
      throw new Error(`Failed to refresh Quickbooks token: ${error.message}`);
    }
  }

  async authenticate() {
    if (!this.refreshToken || !this.realmId) {
      throw new Error('QBO credentials not set — authenticate with OAuth first');
    }

    // Check if token exists and is still valid
    const now = new Date();
    if (!this.accessToken || !this.accessTokenExpiry || this.accessTokenExpiry <= now) {
      const tokenResponse = await this.refreshAccessToken();
      this.accessToken = tokenResponse.access_token;
    }
    
    this.quickbooksInstance = new QuickBooks(
      this.clientId,
      this.clientSecret,
      this.accessToken,
      false, // no token secret for OAuth 2.0
      this.realmId!, // Safe to use ! here as we checked above
      this.environment === 'sandbox', // use the sandbox?
      false, // debug?
      null, // minor version
      '2.0', // oauth version
      this.refreshToken
    );
    
    return this.quickbooksInstance;
  }
  
  getQuickbooks() {
    if (!this.quickbooksInstance) {
      throw new Error('Quickbooks not authenticated. Call authenticate() first');
    }
    return this.quickbooksInstance;
  }

  getRefreshToken(): string | undefined {
    return this.refreshToken;
  }

  getRealmId(): string | undefined {
    return this.realmId;
  }
}

export const quickbooksClient = new QuickbooksClient({
  clientId: client_id,
  clientSecret: client_secret,
  refreshToken: refresh_token,
  realmId: realm_id,
  environment: environment,
  redirectUri: redirect_uri,
});

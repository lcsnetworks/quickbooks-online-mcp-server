---
name: backend-worker
description: TypeScript/Node.js backend worker for HTTP MCP server, OAuth 2.1, and DO App deployment.
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

All features in this mission: HTTP transport setup, QuickbooksClient refactor, OAuth 2.1 implementation, DO App deployment, Droid config update.

## Key Environment Facts

- **Repo:** `/home/joel/Downloads/quickbooks-online-mcp-server`
- **DO App ID:** `c2468ad9-ddd3-45b5-83ee-beebdb6b1106` (URL: `https://qbo-mcp.lcsnetworks.com`)
- **Auto-deploy:** Push to `main` branch → DO App deploys automatically
- **NEVER start the server locally** — build only, then push to GitHub
- **DO MCP tools available:** Use `digitalocean___apps-update`, `digitalocean___apps-get-deployment-status`
- **Droid config:** `~/.factory/mcp.json`
- **TypeScript:** NodeNext module resolution — all relative imports need `.js` extension

## Critical SDK Import Paths

```typescript
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { OAuthServerProvider, AuthInfo, OAuthTokens } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore, OAuthClientInformationFull } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { SignJWT, jwtVerify } from 'jose';
```

## Work Procedure

### Step 1: Read AGENTS.md and feature description
Read `/home/joel/.factory/missions/adcccb4d-edcb-422c-a93b-e6a323d48eff/AGENTS.md` and the current feature's description from features.json thoroughly before writing any code.

### Step 2: Understand existing code
Read the relevant existing source files before making changes:
- `src/index.ts` — current stdio entry point (50 RegisterTool calls to copy)
- `src/clients/quickbooks-client.ts` — QuickbooksClient to refactor
- `src/server/qbo-mcp-server.ts` — McpServer singleton
- `src/helpers/register-tool.ts` — RegisterTool helper
- `package.json` — current scripts and deps

### Step 3: Implement
Write the code. Key patterns:

**HTTP Server with Stateless MCP Transport:**
```typescript
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { QuickbooksMCPServer } from './server/qbo-mcp-server.js';

const app = express();
app.use(express.json({ limit: '4mb' }));

const mcpServer = QuickbooksMCPServer.GetServer();
// ... RegisterTool(mcpServer, ...) × 50 ...

app.get('/healthz', (_, res) => res.status(200).send('ok'));

// Per-request: fresh transport for stateless operation
const handleMcp = async (req: express.Request, res: express.Response) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req as any, res as any, (req as any).body);
  } finally {
    res.on('finish', () => transport.close().catch(() => {}));
  }
};

app.post('/mcp', bearerAuth, handleMcp);
app.get('/mcp', bearerAuth, handleMcp);
app.delete('/mcp', bearerAuth, handleMcp);

const PORT = parseInt(process.env.PORT || '8080', 10);
app.listen(PORT, () => console.log(`MCP server listening on ${PORT}`));
```

**Static Bearer Auth (Milestone 1):**
```typescript
const bearerAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const header = req.headers.authorization ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  const token = header.slice(7);
  if (token !== process.env.MCP_API_KEY) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  next();
};
```

**JWT Operations (Milestone 2):**
```typescript
import { SignJWT, jwtVerify } from 'jose';
const getSecret = () => new TextEncoder().encode(process.env.JWT_SECRET!);

// Issue 30-day JWT
const jwt = await new SignJWT({ realmId, refreshToken })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('30d')
  .sign(getSecret());

// Verify JWT
const { payload } = await jwtVerify(token, getSecret());
const { realmId, refreshToken } = payload as { realmId: string; refreshToken: string };
```

**OAuthServerProvider (Milestone 2) — minimal working implementation:**
```typescript
import { OAuthServerProvider, AuthInfo, OAuthTokens, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { Response } from 'express';
import OAuthClient from 'intuit-oauth';
import { jwtVerify, SignJWT } from 'jose';
import crypto from 'crypto';
import { quickbooksClient } from '../clients/quickbooks-client.js';

interface AuthCodeEntry {
  jwt: string;
  codeChallenge: string;
  expiresAt: number;
}

export class QBOOAuthProvider implements OAuthServerProvider {
  private clients = new Map<string, OAuthClientInformationFull>();
  private authCodes = new Map<string, AuthCodeEntry>();
  private oauthClient: OAuthClient;

  clientsStore: OAuthRegisteredClientsStore = {
    getClient: async (clientId) => this.clients.get(clientId),
    registerClient: async (clientInfo) => {
      const client: OAuthClientInformationFull = {
        ...clientInfo,
        client_id: crypto.randomUUID(),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret: crypto.randomBytes(32).toString('hex'),
        client_secret_expires_at: Math.floor(Date.now() / 1000) + 2592000,
      };
      this.clients.set(client.client_id, client);
      return client;
    },
  };

  constructor() {
    this.oauthClient = new OAuthClient({
      clientId: process.env.QUICKBOOKS_CLIENT_ID!,
      clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
      environment: process.env.QUICKBOOKS_ENVIRONMENT || 'production',
      redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
    });
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const statePayload = {
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      clientState: params.state,
    };
    const encodedState = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
    const authUri = this.oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting as string],
      state: encodedState,
    }).toString();
    res.redirect(authUri);
  }

  async handleCallback(callbackUrl: string, fullUrl: string, res: Response): Promise<void> {
    // Parse state
    const url = new URL(fullUrl);
    const rawState = url.searchParams.get('state') ?? '';
    const state = JSON.parse(Buffer.from(rawState, 'base64url').toString());
    const realmId = url.searchParams.get('realmId') ?? '';

    // Exchange code for QBO tokens
    const tokenResponse = await this.oauthClient.createToken(callbackUrl);
    const { refresh_token: refreshToken } = tokenResponse.token;

    // Create MCP JWT
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const jwt = await new SignJWT({ realmId, refreshToken })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(secret);

    // Store auth code
    const authCode = crypto.randomBytes(32).toString('hex');
    this.authCodes.set(authCode, {
      jwt,
      codeChallenge: state.codeChallenge,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    // Redirect to client
    const redirect = new URL(state.redirectUri);
    redirect.searchParams.set('code', authCode);
    if (state.clientState) redirect.searchParams.set('state', state.clientState);
    res.redirect(redirect.toString());
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, code: string): Promise<string> {
    const entry = this.authCodes.get(code);
    if (!entry || Date.now() > entry.expiresAt) throw new Error('Invalid or expired authorization code');
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(_client: OAuthClientInformationFull, code: string): Promise<OAuthTokens> {
    const entry = this.authCodes.get(code);
    if (!entry || Date.now() > entry.expiresAt) throw new Error('Invalid or expired authorization code');
    this.authCodes.delete(code);
    return { access_token: entry.jwt, token_type: 'bearer', expires_in: 2592000 };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error('Refresh tokens not supported — re-authenticate to get a new 30-day token');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    const { realmId, refreshToken } = payload as { realmId: string; refreshToken: string };
    quickbooksClient.setCredentials(refreshToken, realmId);
    return {
      token,
      clientId: 'qbo',
      scopes: ['qbo'],
      expiresAt: payload.exp,
    };
  }
}
```

**DO App Update (use when deploying):**
Use `digitalocean___apps-update` MCP tool with the full app spec including the new `run_command` and env vars. Check current spec first with `digitalocean___apps-get-info`.

**Generate random secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### Step 4: Verify locally (compile and lint)
```bash
cd /home/joel/Downloads/quickbooks-online-mcp-server
npm run build      # MUST exit 0
npm run lint       # MUST exit 0 (or only warnings)
tsc --noEmit       # MUST exit 0
```
Fix all TypeScript errors and lint violations before proceeding.

### Step 5: Commit and push
```bash
cd /home/joel/Downloads/quickbooks-online-mcp-server
git add -A
git diff --cached  # review for secrets before committing
git status
git commit -m "feat: <description>"
git push origin main
```
NEVER commit secrets. JWT_SECRET and MCP_API_KEY are set as DO App env vars only, not in code.

### Step 6: Deploy verification (only for deploy features)
```bash
# Wait for DO App to deploy (poll every 30s for up to 5 minutes)
# Use digitalocean___apps-get-deployment-status to check
# Then test with curl:
curl -i https://qbo-mcp.lcsnetworks.com/healthz
curl -i -X POST https://qbo-mcp.lcsnetworks.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

### Step 7: Return to Orchestrator
If the DO App deployment fails or the OAuth flow has an issue that requires user interaction (e.g., QBO OAuth requires real browser login), return to orchestrator.

## Example Handoff

```json
{
  "salientSummary": "Implemented QBO OAuth provider (src/auth/qbo-oauth-provider.ts) with in-memory clients store, QBO-based authorize flow, JWT issuance via jose (HS256, 30-day expiry), and requireBearerAuth on /mcp. Mounted mcpAuthRouter for OAuth endpoints. npm run build exit 0, tsc --noEmit exit 0, npm run lint exit 0. Pushed to main, DO App deployed successfully (ACTIVE). Verified: /.well-known/oauth-authorization-server returns correct metadata; POST /register returns 201; POST /mcp without auth returns 401 with WWW-Authenticate; POST /mcp with valid test JWT returns 200 MCP response.",
  "whatWasImplemented": "QBOOAuthProvider class implementing OAuthServerProvider interface. Mounted mcpAuthRouter on Express app. Added GET /callback handler for QBO OAuth code exchange and JWT issuance. Replaced static MCP_API_KEY auth with requireBearerAuth({ verifier: provider }). JWT tokens signed HS256, 30-day expiry, contain {realmId, refreshToken}. verifyAccessToken() calls quickbooksClient.setCredentials() to inject QBO credentials from JWT.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm run build", "exitCode": 0, "observation": "TypeScript compiled successfully, dist/index.js generated" },
      { "command": "npm run lint", "exitCode": 0, "observation": "No lint errors" },
      { "command": "tsc --noEmit", "exitCode": 0, "observation": "No type errors" },
      { "command": "git push origin main", "exitCode": 0, "observation": "Triggered DO App auto-deploy" },
      { "command": "curl -i https://qbo-mcp.lcsnetworks.com/.well-known/oauth-authorization-server", "exitCode": 0, "observation": "200 JSON with issuer=https://qbo-mcp.lcsnetworks.com, authorization_endpoint, token_endpoint, registration_endpoint, code_challenge_methods_supported=[S256]" },
      { "command": "curl -i -X POST https://qbo-mcp.lcsnetworks.com/register -H 'Content-Type: application/json' -d '{\"redirect_uris\":[\"http://localhost/cb\"]}'", "exitCode": 0, "observation": "201 with client_id (UUID) and client_secret (64-char hex)" },
      { "command": "curl -i -X POST https://qbo-mcp.lcsnetworks.com/mcp", "exitCode": 0, "observation": "401 with WWW-Authenticate: Bearer header and JSON error body" },
      { "command": "node -e \"/* jose generate test JWT */ ... \" | xargs curl -X POST /mcp -H 'Authorization: Bearer ...' ...", "exitCode": 0, "observation": "200 with MCP initialize result, serverInfo.name=QuickBooks Online MCP Server" }
    ],
    "interactiveChecks": []
  },
  "tests": { "added": [] },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- DO App deployment fails after push (not just slow — actually fails)
- A required env var (JWT_SECRET, QUICKBOOKS_CLIENT_ID) is missing from DO App and cannot be retrieved
- TypeScript errors that require architectural decisions (e.g., SDK type incompatibilities)
- OAuth flow requires QBO sandbox/production credentials that are unavailable
- Droid config location has changed or is inaccessible

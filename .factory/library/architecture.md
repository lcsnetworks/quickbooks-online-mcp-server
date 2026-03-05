# Architecture

Architectural decisions and patterns for the HTTP MCP + OAuth conversion.

---

## Transport: Stateless Streamable HTTP

- **SDK:** `@modelcontextprotocol/sdk` v1.20.0 (installed)
- **Transport class:** `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`
- **Mode:** Stateless (`sessionIdGenerator: undefined`)
- **Pattern:** Create a new `StreamableHTTPServerTransport` per request; use singleton `McpServer` with tools registered once

## Tool Registration

All 50 QBO tools are registered on the McpServer singleton once at startup (copied from `src/index.ts`). The 50 tools cover: customers (5), estimates (5), bills (5), invoices (4), accounts (3), items (4), vendors (5), employees (4), journal entries (5), bill payments (5), purchases (5).

## Authentication: Stateless JWT Bearer Tokens

The server is single-tenant (one QBO account). Authentication flow:
1. Client (Droid) → `GET /authorize` → redirect to QBO OAuth
2. User authorizes on QBO → `GET /callback?code=...&realmId=...`
3. Server exchanges QBO code for QBO tokens; creates JWT `{realmId, refreshToken}` signed HS256 with `JWT_SECRET`, expiry 30 days
4. JWT returned as MCP access token via `POST /token`
5. Client sends JWT as `Authorization: Bearer <jwt>` on every MCP request
6. Server verifies JWT, extracts QBO credentials, calls `quickbooksClient.setCredentials()`, then handles MCP request

**No server-side token storage** — the JWT IS the credentials (same model as Stripe MCP).

## QuickbooksClient Changes

The singleton `quickbooksClient` is modified to:
- Remove browser-based OAuth (`startOAuthFlow`, `open` browser)
- Remove file-system token persistence (`saveTokensToEnv`)
- Add `setCredentials(refreshToken, realmId)` — called by `verifyAccessToken` when processing each request
- Keep access token cache (1-hour TTL) to avoid calling QBO OAuth on every request
- `clientId`, `clientSecret`, `redirectUri`, `environment` still come from env vars at startup

## OAuth 2.1 Provider

Class `QBOOAuthProvider` in `src/auth/qbo-oauth-provider.ts` implements `OAuthServerProvider`:
- `clientsStore`: In-memory Map (not persisted — clients must re-register after restart)
- `authorize()`: Encodes MCP client context in base64url state, redirects to QBO
- `handleCallback()`: Exchanges QBO code, creates JWT, redirects to MCP client with auth code
- `challengeForAuthorizationCode()`: Returns code_challenge from in-memory auth codes map
- `exchangeAuthorizationCode()`: Returns JWT as `access_token`, single-use auth codes
- `verifyAccessToken()`: Verifies JWT signature with `JWT_SECRET`, injects QBO credentials into client
- `exchangeRefreshToken()`: Throws (not supported — 30-day tokens, re-auth after expiry)

## OAuth Routes (via mcpAuthRouter)

Automatically mounted by `mcpAuthRouter`:
- `GET /.well-known/oauth-authorization-server` — OAuth metadata
- `GET /.well-known/oauth-protected-resource` — resource metadata
- `GET /authorize` — start auth flow
- `POST /token` — exchange auth code for JWT
- `POST /register` — dynamic client registration
- `DELETE /revoke` — token revocation (optional)

Custom route (added manually):
- `GET /callback` — QBO OAuth callback

## Express App Structure

```
GET  /healthz                          → no auth, returns "ok"
GET  /.well-known/oauth-*              → mcpAuthRouter (no auth)
GET  /authorize                        → mcpAuthRouter → provider.authorize()
POST /token                            → mcpAuthRouter → provider.exchangeAuthorizationCode()
POST /register                         → mcpAuthRouter → clientsStore.registerClient()
GET  /callback                         → custom handler → provider.handleCallback()
POST /mcp                              → requireBearerAuth → handleMcp()
GET  /mcp                              → requireBearerAuth → handleMcp()  (SSE)
DELETE /mcp                            → requireBearerAuth → handleMcp()
```

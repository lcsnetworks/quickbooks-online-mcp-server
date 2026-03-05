# Threat Model

## 1. System Overview

This repository exposes a QuickBooks Online MCP server over HTTP. The main runtime components are:

- `src/http-server.ts`: Express entrypoint for OAuth routes, callback handling, and `/mcp` transport.
- `src/auth/qbo-oauth-provider.ts`: OAuth provider that registers MCP clients, drives the Intuit authorization flow, and issues bearer tokens.
- `src/clients/quickbooks-client.ts`: QuickBooks client singleton that refreshes Intuit access tokens and performs API calls.
- `callback-service/server.js`: local helper callback server for manual QuickBooks token bootstrap.
- `src/tools/**` and `src/handlers/**`: MCP tool surface and QuickBooks API adapters.

The system is effectively single-tenant for a single QuickBooks realm at runtime, but it accepts external OAuth and MCP traffic over HTTP.

## 2. Trust Boundaries and Security Zones

### Public zone
- `GET /authorize`
- `POST /register`
- `POST /token`
- `GET /callback`
- `callback-service/server.js` local callback endpoint

These endpoints process browser or client-controlled input and cross the highest-risk trust boundary.

### Authenticated zone
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`
- `/mcp/sessions/:sessionId/messages`

These endpoints require bearer authentication, but still process client-controlled MCP payloads.

### Internal zone
- Environment-backed secrets (`QUICKBOOKS_CLIENT_SECRET`, `JWT_SECRET`, refresh tokens)
- QuickBooks outbound API calls
- In-memory OAuth client and auth-code stores

## 3. Critical Assets

- QuickBooks refresh tokens and access tokens
- QuickBooks realm ID
- `JWT_SECRET`
- Registered OAuth client metadata and redirect URIs
- MCP responses containing customer, invoice, bill, vendor, employee, and journal-entry data

## 4. Attack Surface Inventory

- OAuth redirect and token exchange flow
- Dynamic client registration and redirect URI handling
- Bearer token verification and credential injection into the QuickBooks client
- MCP request transport lifecycle and response routing
- Search criteria accepted by QuickBooks query tools
- Local callback helper HTML responses

## 5. Threat Analysis (STRIDE)

### Spoofing
- OAuth state, authorization codes, and generated client secrets must be cryptographically unpredictable.
- Redirect URIs must be validated to prevent attacker-controlled browser redirects to unsafe schemes.

### Tampering
- MCP clients can submit search criteria; criteria must remain constrained to flat record objects and approved fields.
- QuickBooks callback parameters must not be trusted until state and realm binding are validated.

### Repudiation
- The service has basic server-side logging but no durable audit trail. This is acceptable for the current single-node deployment, but not sufficient for regulated environments.

### Information Disclosure
- Bearer tokens must not expose QuickBooks refresh tokens in plaintext.
- Cross-client response mix-ups must be prevented by isolating MCP server/transport instances per request.
- Callback and OAuth errors should not reflect internal exception details to users.

### Denial of Service
- DNS rebinding and malformed host headers can turn a local or reverse-proxied MCP server into a browser-reachable target.
- Search criteria passed into `node-quickbooks` should remain shallow. Current tool schemas accept arrays of flat records and do not allow nested arrays, which materially reduces reachability of the transitive `underscore` recursion advisory.

### Elevation of Privilege
- If bearer token contents leak or redirect validation is weak, attackers could obtain longer-lived QuickBooks credentials than intended.

## 6. Confirmed Risk Areas Addressed In This Audit

- Per-request MCP server isolation for stateless HTTP transport
- Host-header allow-list validation for HTTP entrypoints
- Encrypted bearer tokens for embedded QuickBooks credentials
- Cryptographically secure randomness for auth state, client secrets, auth codes, and token IDs
- Redirect URI validation blocking unsafe browser-executable schemes
- Local callback hardening: loopback bind, no-store headers, escaped HTML output, and required OAuth state

## 7. Vulnerability Pattern Library

### Unsafe randomness
- Vulnerable: `Math.random()` for OAuth state, secrets, or codes
- Safe: `crypto.randomBytes(...)` / `crypto.randomUUID()`

### Credential-bearing bearer tokens
- Vulnerable: signed-only JWT payloads containing refresh tokens
- Safe: encrypted bearer tokens or server-side credential indirection

### Shared stateless MCP server instances
- Vulnerable: reusing one `McpServer` across multiple transports/clients
- Safe: create a fresh `McpServer` per request/session

### Unsafe redirect URIs
- Vulnerable: accepting `javascript:` or `data:` redirect URIs
- Safe: require absolute URIs and reject dangerous schemes and fragments

### HTML reflection in callback helpers
- Vulnerable: embedding raw token or error values into HTML
- Safe: escape HTML and send `Cache-Control: no-store`

## 8. Security Testing Strategy

- `npm audit` for dependency review
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- Manual review of auth/OAuth transport lifecycle and callback flows

## 9. Assumptions and Accepted Risks

- The remaining `node-quickbooks -> underscore` advisory is not treated as a confirmed exploitable runtime issue here because the exposed search-tool schemas restrict criteria to flat objects/arrays rather than attacker-controlled deeply nested arrays.
- OAuth client and auth-code stores remain in-memory and are lost on restart.
- This deployment is not modeled as a multi-node clustered service.

## 10. Changelog

- 2026-03-05: Initial threat model created during full-repository security audit.

# User Testing

Testing surface, tools, and setup for validators.

---

## Testing Surface

**Primary testing method:** `curl` against the production DO App at `https://qbo-mcp.lcsnetworks.com`

**No local server testing** — the server runs on DO Apps. All validation is against production.

## Milestone 1 Testing (HTTP Transport)

**Required:** `MCP_API_KEY` value — ask the worker's handoff for the value, or retrieve via DO API.

```bash
# Health check
curl -i https://qbo-mcp.lcsnetworks.com/healthz
# Expected: 200 OK, body: ok

# Auth required
curl -i -X POST https://qbo-mcp.lcsnetworks.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
# Expected: 401 with WWW-Authenticate header

# MCP Initialize
MCP_API_KEY="<value-from-handoff>"
curl -i -X POST https://qbo-mcp.lcsnetworks.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
# Expected: 200 with {"result":{"serverInfo":{"name":"QuickBooks Online MCP Server",...}}}

# Tools list
curl -s -X POST https://qbo-mcp.lcsnetworks.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | python3 -m json.tool | grep '"name"' | wc -l
# Expected: 50
```

## Milestone 2 Testing (OAuth)

**OAuth metadata:**
```bash
curl -s https://qbo-mcp.lcsnetworks.com/.well-known/oauth-authorization-server | python3 -m json.tool
```

**Dynamic Client Registration:**
```bash
curl -s -X POST https://qbo-mcp.lcsnetworks.com/register \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris":["http://localhost/callback"]}' | python3 -m json.tool
```

**Create test JWT (requires JWT_SECRET from DO App):**
```bash
JWT_SECRET="<value-from-do-app>"
node -e "
const { SignJWT } = require('jose');
const secret = new TextEncoder().encode('$JWT_SECRET');
new SignJWT({ realmId: 'test-realm', refreshToken: 'fake-token' })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('30d')
  .sign(secret)
  .then(console.log);
"
```

**Test /mcp with JWT:**
```bash
curl -i -X POST https://qbo-mcp.lcsnetworks.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_JWT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

**Test QBO tool call (invalid credentials — should return MCP error, not HTTP 500):**
```bash
curl -s -X POST https://qbo-mcp.lcsnetworks.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_JWT_WITH_FAKE_TOKEN" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_customers","arguments":{"params":{"criteria":[]}}}}' | python3 -m json.tool
# Expected: 200 HTTP, content[0].text contains "Error" (MCP-level error, not HTTP 500)
```

## VAL-CROSS-001: Full E2E OAuth Flow (Manual Step)

This assertion requires the user to manually connect in Droid after the Droid config is updated:
1. User restarts Droid after `~/.factory/mcp.json` is updated
2. Droid detects the new HTTP MCP server at `https://qbo-mcp.lcsnetworks.com/mcp`
3. Droid prompts "Authenticate with QuickBooks MCP" (OAuth flow)
4. User clicks → browser opens to QBO OAuth
5. User logs in on QBO and approves
6. Droid receives bearer token
7. User runs a QBO tool (e.g., search_customers) and verifies it returns data

**This is the final human-in-the-loop validation step.** All other assertions can be tested programmatically.

## Known Constraints

- QBO OAuth requires real QBO credentials (sandbox or production)
- The `QUICKBOOKS_REFRESH_TOKEN` env var may not be set on DO App initially (tokens come from the OAuth flow)
- The DO App may take 2-5 minutes to deploy after a git push

# Environment

Environment variables and external dependencies.

**What belongs here:** Required env vars, DO App config, QBO API context.
**What does NOT belong here:** Service ports/commands (see services.yaml).

---

## DO App Environment Variables

Set on the DO App (App ID: c2468ad9-ddd3-45b5-83ee-beebdb6b1106):

| Variable | Required | Notes |
|----------|----------|-------|
| `QUICKBOOKS_CLIENT_ID` | Yes | QBO OAuth app client ID |
| `QUICKBOOKS_CLIENT_SECRET` | Yes (SECRET) | QBO OAuth app client secret |
| `QUICKBOOKS_ENVIRONMENT` | Yes | `production` or `sandbox` |
| `QUICKBOOKS_REDIRECT_URI` | Yes | `https://qbo-mcp.lcsnetworks.com/callback` |
| `JWT_SECRET` | Yes (SECRET) | 32+ char random string; signs/verifies MCP bearer tokens |
| `MCP_API_KEY` | M1 only (SECRET) | Static Bearer key for Milestone 1 testing; removed in M2 |
| `QUICKBOOKS_OAUTH_STATE` | **REMOVED** | Was used by old callback service; no longer needed |
| `NODE_ENV` | Yes | `production` |

## Local .env File

The local `.env` file at repo root contains QBO credentials for local development.
**NEVER edit it** (per AGENTS.md). It does NOT contain JWT_SECRET or MCP_API_KEY (those are DO-only secrets).

## QBO OAuth Configuration

- QBO OAuth App registered at: https://developer.intuit.com/
- Redirect URI registered: `https://qbo-mcp.lcsnetworks.com/callback`
- Scopes used: `com.intuit.quickbooks.accounting`
- Environment: `production` (configured in DO App env vars)

## GitHub Auto-Deploy

- Repo: `lcsnetworks/quickbooks-online-mcp-server`
- Branch: `main`
- Deploy on push: enabled
- Build: Node.js buildpack runs `npm install` (triggers `prepare` → `tsc`)
- Run: `node dist/index.js`

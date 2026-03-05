# QuickBooks Online MCP Server

This is a Model Context Protocol (MCP) server implementation for QuickBooks Online integration, using HTTP transport with OAuth 2.1 Device Authorization Grant.

## Configuration

Add the following to your MCP client configuration (e.g., `~/.factory/mcp.json`):

```json
{
  "mcpServers": {
    "quickbooks": {
      "type": "http",
      "url": "https://qbo-mcp.lcsnetworks.com/mcp",
      "disabled": false
    }
  }
}
```

## Authentication

### OAuth Flow

The QuickBooks MCP server uses OAuth 2.1 for authentication. To connect:

1. **Click the "Authorize" button** provided by the MCP server in your AI assistant interface
2. **Complete QuickBooks login** - You'll be redirected to QuickBooks to sign in with your credentials
3. **Grant permissions** - Approve the requested scopes for the app
4. **Automatic token setup** - After successful authorization, the server will store your tokens and you'll receive a 30-day access token

The OAuth flow is handled entirely through the HTTP interface - no local server or additional setup required on your machine.

### Token Management

- **Access tokens** are valid for approximately 30 days
- **Refresh tokens** are used to obtain new access tokens automatically
- The server handles token refresh transparently in the background
- If you see "QuickBooks not connected" errors, simply repeat the authorization process

## Usage

After authentication is complete, you can use the MCP server to interact with QuickBooks Online. The server provides various tools for managing customers, estimates, bills, and more.

## Available Tools

The server provides Create, Delete, Get, Search, and Update tools for the following entities:

- Account
- Bill Payment
- Bill
- Customer
- Employee
- Estimate
- Invoice
- Item
- Journal Entry
- Purchase
- Vendor


## Error Handling

If you see an error message like "QuickBooks not connected", make sure to:

1. Complete the OAuth authorization flow (click "Authorize" button)
2. Verify that your QuickBooks credentials are correct
3. Check that your tokens are still valid (access tokens expire after ~30 days)


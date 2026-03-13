#!/usr/bin/env node

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createQuickbooksMCPServer } from "./server/qbo-mcp-server.js";
import { RegisterTool } from "./helpers/register-tool.js";
import { qboOAuthProvider } from "./auth/qbo-oauth-provider.js";
import { authSessionStore, AuthSession } from "./auth/auth-session-store.js";

// Tool imports
import { CreateInvoiceTool } from "./tools/create-invoice.tool.js";
import { ReadInvoiceTool } from "./tools/read-invoice.tool.js";
import { SearchInvoicesTool } from "./tools/search-invoices.tool.js";
import { UpdateInvoiceTool } from "./tools/update-invoice.tool.js";
import { CreateAccountTool } from "./tools/create-account.tool.js";
import { UpdateAccountTool } from "./tools/update-account.tool.js";
import { SearchAccountsTool } from "./tools/search-accounts.tool.js";
import { ReadItemTool } from "./tools/read-item.tool.js";
import { SearchItemsTool } from "./tools/search-items.tool.js";
import { CreateItemTool } from "./tools/create-item.tool.js";
import { UpdateItemTool } from "./tools/update-item.tool.js";
import { CreateCustomerTool } from "./tools/create-customer.tool.js";
import { GetCustomerTool } from "./tools/get-customer.tool.js";
import { UpdateCustomerTool } from "./tools/update-customer.tool.js";
import { DeleteCustomerTool } from "./tools/delete-customer.tool.js";
import { CreateEstimateTool } from "./tools/create-estimate.tool.js";
import { GetEstimateTool } from "./tools/get-estimate.tool.js";
import { UpdateEstimateTool } from "./tools/update-estimate.tool.js";
import { DeleteEstimateTool } from "./tools/delete-estimate.tool.js";
import { SearchCustomersTool } from "./tools/search-customers.tool.js";
import { SearchEstimatesTool } from "./tools/search-estimates.tool.js";
import { CreateBillTool } from "./tools/create-bill.tool.js";
import { UpdateBillTool } from "./tools/update-bill.tool.js";
import { DeleteBillTool } from "./tools/delete-bill.tool.js";
import { GetBillTool } from "./tools/get-bill.tool.js";
import { CreateVendorTool } from "./tools/create-vendor.tool.js";
import { UpdateVendorTool } from "./tools/update-vendor.tool.js";
import { DeleteVendorTool } from "./tools/delete-vendor.tool.js";
import { GetVendorTool } from "./tools/get-vendor.tool.js";
import { SearchBillsTool } from "./tools/search-bills.tool.js";
import { SearchVendorsTool } from "./tools/search-vendors.tool.js";

// Employee tools
import { CreateEmployeeTool } from "./tools/create-employee.tool.js";
import { GetEmployeeTool } from "./tools/get-employee.tool.js";
import { UpdateEmployeeTool } from "./tools/update-employee.tool.js";
import { SearchEmployeesTool } from "./tools/search-employees.tool.js";

// Journal Entry tools
import { CreateJournalEntryTool } from "./tools/create-journal-entry.tool.js";
import { GetJournalEntryTool } from "./tools/get-journal-entry.tool.js";
import { UpdateJournalEntryTool } from "./tools/update-journal-entry.tool.js";
import { DeleteJournalEntryTool } from "./tools/delete-journal-entry.tool.js";
import { SearchJournalEntriesTool } from "./tools/search-journal-entries.tool.js";

// Bill Payment tools
import { CreateBillPaymentTool } from "./tools/create-bill-payment.tool.js";
import { GetBillPaymentTool } from "./tools/get-bill-payment.tool.js";
import { UpdateBillPaymentTool } from "./tools/update-bill-payment.tool.js";
import { DeleteBillPaymentTool } from "./tools/delete-bill-payment.tool.js";
import { SearchBillPaymentsTool } from "./tools/search-bill-payments.tool.js";

// Purchase tools
import { CreatePurchaseTool } from "./tools/create-purchase.tool.js";
import { GetPurchaseTool } from "./tools/get-purchase.tool.js";
import { UpdatePurchaseTool } from "./tools/update-purchase.tool.js";
import { DeletePurchaseTool } from "./tools/delete-purchase.tool.js";
import { SearchPurchasesTool } from "./tools/search-purchases.tool.js";

const app = express();

// Parse JSON bodies
app.use(express.json());

function getAllowedHosts(issuerUrl: URL): Set<string> {
  const configuredHosts = (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return new Set([
    issuerUrl.hostname.toLowerCase(),
    "localhost",
    "127.0.0.1",
    "[::1]",
    ...configuredHosts,
  ]);
}

function validateHostHeader(req: express.Request, res: express.Response, next: express.NextFunction) {
  const hostHeader = req.headers.host;
  if (!hostHeader) {
    res.status(400).json({ error: "Missing Host header" });
    return;
  }

  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    res.status(400).json({ error: "Invalid Host header" });
    return;
  }

  if (!allowedHosts.has(hostname)) {
    res.status(403).json({ error: "Host header not allowed" });
    return;
  }

  next();
}

// Health check endpoint (no auth required)
app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Mount OAuth authorization endpoints
// These handle: /authorize, /token, /register, /revoke, /.well-known/oauth-authorization-server
// Use OAUTH_ISSUER_URL env var if set, otherwise default to production domain
const issuerUrl = new URL(process.env.OAUTH_ISSUER_URL || `https://qbo-mcp.lcsnetworks.com`);
const allowedHosts = getAllowedHosts(issuerUrl);

app.use(validateHostHeader);

app.use("/", mcpAuthRouter({ provider: qboOAuthProvider, issuerUrl }));

// QuickBooks OAuth callback handler
app.get("/callback", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const callbackUrl = new URL(req.url, process.env.OAUTH_ISSUER_URL || `https://qbo-mcp.lcsnetworks.com`);
    
    // Check if this is a headless flow by looking for the headless session
    const qboState = callbackUrl.searchParams.get("state");
    const headlessSession = qboState ? authSessionStore.getSessionByQBOState(qboState) : null;
    
    if (headlessSession) {
      // Headless flow: complete the session and show one-time code
      try {
        await qboOAuthProvider.handleHeadlessCallback(callbackUrl.searchParams, headlessSession);
      } catch (callbackError: any) {
        // Check if this is our success signal
        if (callbackError.name === "HeadlessCallbackSuccess" && callbackError.token && callbackError.sessionId) {
          authSessionStore.completeSession(callbackError.sessionId, callbackError.token);
          // Redirect to the completion page
          res.redirect(`/auth/complete/${callbackError.sessionId}`);
          return;
        }
        // Re-throw other errors
        throw callbackError;
      }
      return;
    }
    
    // Normal flow: redirect back to client
    const result = await qboOAuthProvider.handleCallback(callbackUrl.searchParams);
    res.redirect(result.uri.toString());
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).send("OAuth callback failed");
  }
});

// Headless auth endpoints for remote/headless clients

// POST /auth/headless/start - Start a headless auth session
// Body: { clientId, redirectUri, scopes, state? }
app.post("/auth/headless/start", async (req, res) => {
  try {
    const { clientId, redirectUri, scopes, state } = req.body;
    
    if (!clientId || !redirectUri) {
      res.status(400).json({ error: "clientId and redirectUri are required" });
      return;
    }

    // Create a new headless auth session
    const session = authSessionStore.createSession({
      clientId,
      redirectUri,
      scopes: scopes || [],
      state,
    });

    // Return the session ID and the browser URL the user should open
    const browserUrl = new URL(`/auth/browser/${session.sessionId}`, issuerUrl).toString();

    res.json({
      sessionId: session.sessionId,
      browserUrl,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error("Headless auth start error:", error);
    res.status(500).json({ error: "Failed to start headless auth" });
  }
});

// GET /auth/browser/:sessionId - Browser URL for user to open
// This redirects to QuickBooks OAuth
app.get("/auth/browser/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = authSessionStore.getSession(sessionId);

    if (!session) {
      res.status(404).send("Session not found or expired");
      return;
    }

    // Generate QBO state and store it with the session
    const qboState = randomBytes(16).toString("base64url");
    authSessionStore.setQBOState(sessionId, qboState);

    // Build QuickBooks authorization URL
    const qboAuthUrl = new URL(process.env.QUICKBOOKS_AUTHORIZE_URL || "https://appcenter.intuit.com/connect/oauth2");
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${issuerUrl.origin}/callback`;
    const scopes = process.env.QUICKBOOKS_OAUTH_SCOPES || "com.intuit.quickbooks.accounting";
    
    if (!clientId) {
      res.status(500).send("QUICKBOOKS_CLIENT_ID not configured");
      return;
    }
    
    qboAuthUrl.searchParams.set("client_id", clientId);
    qboAuthUrl.searchParams.set("response_type", "code");
    qboAuthUrl.searchParams.set("redirect_uri", redirectUri);
    qboAuthUrl.searchParams.set("state", qboState);
    qboAuthUrl.searchParams.set("realmId", "0");
    qboAuthUrl.searchParams.set("scope", scopes);
    qboAuthUrl.searchParams.set("prompt", "login");

    res.redirect(qboAuthUrl.toString());
  } catch (error) {
    console.error("Browser auth error:", error);
    res.status(500).send("Authorization failed");
  }
});

// GET /auth/complete/:sessionId - Show one-time code after successful OAuth
app.get("/auth/complete/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = authSessionStore.getSession(sessionId);

    if (!session) {
      res.status(404).send("Session not found or expired");
      return;
    }

    if (session.status !== "completed" || !session.oneTimeCode) {
      // Poll redirect - wait for completion
      res.setHeader("Refresh", "2;url=/auth/complete/" + sessionId);
      res.send(`<!doctype html>
<html><body style="font-family: sans-serif; max-width: 600px; margin: 40px auto; text-align: center;">
  <h2>Completing authorization...</h2>
  <p>Please wait while we finalize your session.</p>
</body></html>`);
      return;
    }

    // Show the one-time code
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    res.send(`<!doctype html>
<html><body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
  <h2>Authorization Complete</h2>
  <p>Copy this code and paste it into your application:</p>
  <div style="background:#f5f5f5; padding:20px; border-radius:8px; text-align:center; font-size:24px; letter-spacing:4px; font-family:monospace;">
    ${session.oneTimeCode}
  </div>
  <p style="color:#666; font-size:14px;">This code expires in 5 minutes. Do not share this code.</p>
</body></html>`);
  } catch (error) {
    console.error("Complete page error:", error);
    res.status(500).send("Error completing authorization");
  }
});

// POST /auth/redeem - Exchange one-time code for MCP token
// Body: { sessionId, code }
app.post("/auth/redeem", async (req, res) => {
  try {
    const { sessionId, code } = req.body;

    if (!sessionId || !code) {
      res.status(400).json({ error: "sessionId and code are required" });
      return;
    }

    const token = authSessionStore.redeemCode(sessionId, code);
    
    res.json({
      access_token: token,
      token_type: "bearer",
      expires_in: 30 * 24 * 60 * 60, // 30 days
    });
  } catch (error) {
    console.error("Code redeem error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid or expired code" });
  }
});

// GET /auth/status/:sessionId - Check headless session status
app.get("/auth/status/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = authSessionStore.getSession(sessionId);

  if (!session) {
    res.status(404).json({ status: "not_found" });
    return;
  }

  res.json({
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  });
});

// Import randomBytes for the browser endpoint
import { randomBytes } from "node:crypto";

// Bearer auth middleware using SDK's requireBearerAuth
// Includes resource_metadata in WWW-Authenticate header for MCP client auth discovery
// The middleware handles authentication errors internally and returns 401/403/500 as appropriate
const bearerAuthMiddleware = requireBearerAuth({
  verifier: qboOAuthProvider,
  resourceMetadataUrl: new URL("/.well-known/oauth-protected-resource", issuerUrl).toString(),
});

// Register all 50 tools to the MCP server
function registerAllTools(server: ReturnType<typeof createQuickbooksMCPServer>) {
  // Add tools for customers
  RegisterTool(server, CreateCustomerTool);
  RegisterTool(server, GetCustomerTool);
  RegisterTool(server, UpdateCustomerTool);
  RegisterTool(server, DeleteCustomerTool);
  RegisterTool(server, SearchCustomersTool);
  // Add tools for estimates
  RegisterTool(server, CreateEstimateTool);
  RegisterTool(server, GetEstimateTool);
  RegisterTool(server, UpdateEstimateTool);
  RegisterTool(server, DeleteEstimateTool);
  RegisterTool(server, SearchEstimatesTool);
  
  // Add tools for bills
  RegisterTool(server, CreateBillTool);
  RegisterTool(server, UpdateBillTool);
  RegisterTool(server, DeleteBillTool);
  RegisterTool(server, GetBillTool);
  RegisterTool(server, SearchBillsTool);

  // Add tool to read a single invoice
  RegisterTool(server, ReadInvoiceTool);

  // Add tool to search invoices
  RegisterTool(server, SearchInvoicesTool);

  // Add tool to create invoice
  RegisterTool(server, CreateInvoiceTool);

  // Add tool to update invoice
  RegisterTool(server, UpdateInvoiceTool);

  // Chart of accounts tools
  RegisterTool(server, CreateAccountTool);
  RegisterTool(server, UpdateAccountTool);
  RegisterTool(server, SearchAccountsTool);

  // Add tool to read item
  RegisterTool(server, ReadItemTool);
  RegisterTool(server, SearchItemsTool);
  RegisterTool(server, CreateItemTool);
  RegisterTool(server, UpdateItemTool);

  // Add tools for vendors
  RegisterTool(server, CreateVendorTool);
  RegisterTool(server, UpdateVendorTool);
  RegisterTool(server, DeleteVendorTool);
  RegisterTool(server, GetVendorTool);
  RegisterTool(server, SearchVendorsTool);

  // Add tools for employees
  RegisterTool(server, CreateEmployeeTool);
  RegisterTool(server, GetEmployeeTool);
  RegisterTool(server, UpdateEmployeeTool);
  RegisterTool(server, SearchEmployeesTool);

  // Add tools for journal entries
  RegisterTool(server, CreateJournalEntryTool);
  RegisterTool(server, GetJournalEntryTool);
  RegisterTool(server, UpdateJournalEntryTool);
  RegisterTool(server, DeleteJournalEntryTool);
  RegisterTool(server, SearchJournalEntriesTool);

  // Add tools for bill payments
  RegisterTool(server, CreateBillPaymentTool);
  RegisterTool(server, GetBillPaymentTool);
  RegisterTool(server, UpdateBillPaymentTool);
  RegisterTool(server, DeleteBillPaymentTool);
  RegisterTool(server, SearchBillPaymentsTool);

  // Add tools for purchases
  RegisterTool(server, CreatePurchaseTool);
  RegisterTool(server, GetPurchaseTool);
  RegisterTool(server, UpdatePurchaseTool);
  RegisterTool(server, DeletePurchaseTool);
  RegisterTool(server, SearchPurchasesTool);
}

function createRegisteredMcpServer() {
  const server = createQuickbooksMCPServer();
  registerAllTools(server);
  return server;
}

async function handleMcpRequest(
  req: express.Request,
  res: express.Response,
  body?: unknown,
) {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createRegisteredMcpServer();

  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

// MCP endpoint handlers (POST, GET, DELETE) with per-request transport creation
// Main /mcp endpoint
app.post("/mcp", bearerAuthMiddleware, async (req: express.Request, res: express.Response) => {
  handleMcpRequest(req, res, req.body).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.get("/mcp", bearerAuthMiddleware, async (req: express.Request, res: express.Response) => {
  handleMcpRequest(req, res).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.delete("/mcp", bearerAuthMiddleware, async (req: express.Request, res: express.Response) => {
  handleMcpRequest(req, res).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// Session-specific message endpoints
app.post("/mcp/sessions/:sessionId/messages", bearerAuthMiddleware, async (req: express.Request, res: express.Response) => {
  handleMcpRequest(req, res, req.body).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.get("/mcp/sessions/:sessionId/messages", bearerAuthMiddleware, async (req: express.Request, res: express.Response) => {
  handleMcpRequest(req, res).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.delete("/mcp/sessions/:sessionId/messages", bearerAuthMiddleware, async (req: express.Request, res: express.Response) => {
  handleMcpRequest(req, res).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// 404 handler for unknown routes
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// 500 error handler for unhandled exceptions
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start the server
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

const startServer = async () => {
  app.listen(PORT, HOST, () => {
    console.log(`HTTP MCP server listening on ${HOST}:${PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

#!/usr/bin/env node

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { QuickbooksMCPServer } from "./server/qbo-mcp-server.js";
import { RegisterTool } from "./helpers/register-tool.js";
import { qboOAuthProvider } from "./auth/qbo-oauth-provider.js";

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

// Health check endpoint (no auth required)
app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Mount OAuth authorization endpoints
// These handle: /authorize, /token, /register, /revoke, /.well-known/oauth-authorization-server
// Use OAUTH_ISSUER_URL env var if set, otherwise default to production domain
const issuerUrl = new URL(process.env.OAUTH_ISSUER_URL || `https://qbo-mcp.lcsnetworks.com`);
app.use("/", mcpAuthRouter({ provider: qboOAuthProvider, issuerUrl }));

// QuickBooks OAuth callback handler
app.get("/callback", async (req, res) => {
  try {
    const callbackUrl = new URL(req.url, process.env.OAUTH_ISSUER_URL || `https://qbo-mcp.lcsnetworks.com`);
    const result = await qboOAuthProvider.handleCallback(callbackUrl.searchParams);
    res.redirect(result.uri.toString());
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).send("OAuth callback error: " + (error instanceof Error ? error.message : String(error)));
  }
});

// Bearer auth middleware using SDK's requireBearerAuth
// Includes resource_metadata in WWW-Authenticate header for MCP client auth discovery
const bearerAuthMiddleware = requireBearerAuth({
  verifier: qboOAuthProvider,
  resourceMetadataUrl: "https://qbo-mcp.lcsnetworks.com/.well-known/oauth-protected-resource",
});

// Register all 50 tools to the MCP server
function registerAllTools(server: ReturnType<typeof QuickbooksMCPServer.GetServer>) {
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

// Initialize the MCP server once at startup
const mcpServer = QuickbooksMCPServer.GetServer();
registerAllTools(mcpServer);

// MCP endpoint handlers (POST, GET, DELETE) with per-request transport creation
// Main /mcp endpoint
app.post("/mcp", bearerAuthMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless
  });
  
  await mcpServer.connect(transport);
  
  // Handle the transport - pass req.body to avoid re-reading the stream
  transport.handleRequest(req, res, req.body).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.get("/mcp", bearerAuthMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless
  });
  
  await mcpServer.connect(transport);
  
  transport.handleRequest(req, res).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.delete("/mcp", bearerAuthMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless
  });
  
  await mcpServer.connect(transport);
  
  transport.handleRequest(req, res).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// Session-specific message endpoints
app.post("/mcp/sessions/:sessionId/messages", bearerAuthMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless
  });
  
  await mcpServer.connect(transport);
  
  transport.handleRequest(req, res, req.body).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.get("/mcp/sessions/:sessionId/messages", bearerAuthMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless
  });
  
  await mcpServer.connect(transport);
  
  transport.handleRequest(req, res).catch((error) => {
    console.error("Transport request error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.delete("/mcp/sessions/:sessionId/messages", bearerAuthMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless
  });
  
  await mcpServer.connect(transport);
  
  transport.handleRequest(req, res).catch((error) => {
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

// Error handler for authentication errors (401)
// This must come before the generic 500 error handler
app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Check if this is an authentication error from requireBearerAuth middleware
  if (err.message && err.message.includes("Invalid access token")) {
    console.error("Authentication error:", err.message);
    res.status(401).json({
      error: "invalid_token",
      error_description: "Access token is invalid or expired",
    });
    return;
  }
  
  // Pass other errors to the generic error handler
  next(err);
});

// 500 error handler for unhandled exceptions
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start the server
const PORT = process.env.PORT || 8080;

const startServer = async () => {
  app.listen(PORT, () => {
    console.log(`HTTP MCP server listening on port ${PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

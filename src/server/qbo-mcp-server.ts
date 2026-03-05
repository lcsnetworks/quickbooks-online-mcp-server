import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createQuickbooksMCPServer(): McpServer {
  return new McpServer({
    name: "QuickBooks Online MCP Server",
    version: "1.0.0",
  });
}
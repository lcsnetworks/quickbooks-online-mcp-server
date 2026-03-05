import http from "http";
import url from "url";
import OAuthClient from "intuit-oauth";
import dotenv from "dotenv";

dotenv.config();

const clientId = process.env.QUICKBOOKS_CLIENT_ID;
const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
const environment = process.env.QUICKBOOKS_ENVIRONMENT || "production";
const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
const expectedState = process.env.QUICKBOOKS_OAUTH_STATE;
const port = process.env.PORT || 8080;
const host = process.env.HOST || "127.0.0.1";

if (!clientId || !clientSecret || !redirectUri || !expectedState) {
  throw new Error("QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_REDIRECT_URI, and QUICKBOOKS_OAUTH_STATE are required");
}

const oauthClient = new OAuthClient({
  clientId,
  clientSecret,
  environment,
  redirectUri,
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setSecureHtmlHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || "", true);

  // Health check
  if (parsed.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (parsed.pathname !== "/callback") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  try {
    if (parsed.query.state !== expectedState) {
      throw new Error("state mismatch");
    }

    const tokenResponse = await oauthClient.createToken(req.url || "");
    const tokens = tokenResponse.token;

    const refreshToken = tokens.refresh_token;
    const realmId = parsed.query.realmId || tokens.realmId;

    setSecureHtmlHeaders(res);

    const html = `<!doctype html>
    <html><body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
      <h2>QuickBooks Connected</h2>
      <p>Copy these values and store them safely (they are not persisted here).</p>
      <pre style="background:#f5f5f5; padding:12px; border-radius:8px;">QUICKBOOKS_REFRESH_TOKEN=${escapeHtml(refreshToken)}
QUICKBOOKS_REALM_ID=${escapeHtml(realmId)}</pre>
    </body></html>`;

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } catch (err) {
    console.error("OAuth callback error", err);
    setSecureHtmlHeaders(res);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>OAuth error</h2><pre>${escapeHtml((err && err.message) || err)}</pre>`);
  }
});

server.listen(port, host, () => {
  console.log(`Callback server listening on ${host}:${port}`);
});

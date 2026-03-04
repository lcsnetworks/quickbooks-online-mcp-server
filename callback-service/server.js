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

if (!clientId || !clientSecret || !redirectUri) {
  throw new Error("QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, and QUICKBOOKS_REDIRECT_URI are required");
}

const oauthClient = new OAuthClient({
  clientId,
  clientSecret,
  environment,
  redirectUri,
});

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
    if (expectedState && parsed.query.state !== expectedState) {
      throw new Error("state mismatch");
    }

    const tokenResponse = await oauthClient.createToken(req.url || "");
    const tokens = tokenResponse.token;

    const refreshToken = tokens.refresh_token;
    const accessToken = tokens.access_token;
    const realmId = parsed.query.realmId || tokens.realmId;

    const html = `<!doctype html>
    <html><body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
      <h2>QuickBooks Connected</h2>
      <p>Copy these values and store them safely (they are not persisted here).</p>
      <pre style="background:#f5f5f5; padding:12px; border-radius:8px;">QUICKBOOKS_REFRESH_TOKEN=${refreshToken}
QUICKBOOKS_REALM_ID=${realmId}</pre>
      <details><summary>Show access token (short-lived)</summary>
        <pre style="background:#f5f5f5; padding:12px; border-radius:8px;">${accessToken}</pre>
      </details>
    </body></html>`;

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } catch (err) {
    console.error("OAuth callback error", err);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>OAuth error</h2><pre>${(err && err.message) || err}</pre>`);
  }
});

server.listen(port, () => {
  console.log(`Callback server listening on ${port}`);
});

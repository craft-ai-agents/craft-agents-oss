#!/usr/bin/env node

// setup.mjs
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var CLIENT_ID = "602890629409.10263167872598";
var CLIENT_SECRET = "***REMOVED***";
var REDIRECT_PORT = 9876;
var REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
var CREDENTIALS_DIR = join(homedir(), ".slack-g4");
var CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
var USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "search:read",
  "users:read",
  "users:read.email"
].join(",");
async function main() {
  console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log("  Slack G4 \u2014 OAuth Setup");
  console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");
  if (existsSync(CREDENTIALS_FILE)) {
    try {
      const creds = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
      console.log(`Existing token found:`);
      console.log(`  Team: ${creds.team_name || "unknown"}`);
      console.log(`  User: ${creds.user_id || "unknown"}`);
      console.log(`  Created: ${creds.created_at || "unknown"}`);
      console.log(`
Re-running will replace the existing token.
`);
    } catch {
    }
  }
  const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${CLIENT_ID}&user_scope=${encodeURIComponent(USER_SCOPES)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<html><body style='font-family:sans-serif;padding:40px;text-align:center'><h1>Authorization denied</h1><p>You can close this window.</p></body></html>"
        );
        server.close();
        reject(new Error(`OAuth denied: ${error}`));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Missing authorization code</h1>");
        return;
      }
      try {
        console.log("Exchanging authorization code for token...");
        const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            redirect_uri: REDIRECT_URI
          })
        });
        const data = await tokenRes.json();
        if (!data.ok) {
          throw new Error(`Token exchange failed: ${data.error}`);
        }
        const xoxpToken = data.authed_user?.access_token;
        if (!xoxpToken) {
          throw new Error("No user access token in response");
        }
        mkdirSync(CREDENTIALS_DIR, { recursive: true });
        const credentials = {
          xoxp_token: xoxpToken,
          user_id: data.authed_user?.id,
          team_id: data.team?.id,
          team_name: data.team?.name,
          scopes: data.authed_user?.scope,
          created_at: (/* @__PURE__ */ new Date()).toISOString()
        };
        writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
        console.log(`
Token saved to ${CREDENTIALS_FILE}`);
        console.log(`  Team: ${data.team?.name}`);
        console.log(`  User: ${data.authed_user?.id}`);
        console.log(`
Setup complete! The MCP server will use this token automatically.`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1 style="color:#2eb67d">Authorized!</h1><p>Token saved for <strong>${data.team?.name || "G4"}</strong>.</p><p style="color:#666">You can close this window.</p></body></html>`
        );
        server.close();
        resolve();
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>Error</h1><p>${err.message}</p>`);
        server.close();
        reject(err);
      }
    });
    server.listen(REDIRECT_PORT, () => {
      console.log(`Callback server listening on http://localhost:${REDIRECT_PORT}`);
      console.log("Opening browser for Slack authorization...\n");
      try {
        if (process.platform === "darwin") {
          execSync(`open "${authUrl}"`);
        } else if (process.platform === "linux") {
          execSync(`xdg-open "${authUrl}"`);
        } else {
          execSync(`start "" "${authUrl}"`);
        }
      } catch {
        console.log("Could not open browser automatically. Please visit:\n");
        console.log(authUrl);
        console.log();
      }
      console.log("Waiting for authorization (timeout: 5 min)...");
    });
    setTimeout(() => {
      console.log("\nTimed out waiting for authorization.");
      server.close();
      reject(new Error("OAuth timeout \u2014 no callback received within 5 minutes"));
    }, 5 * 60 * 1e3);
  });
}
main().catch((err) => {
  console.error(`
Setup failed: ${err.message}`);
  process.exit(1);
});

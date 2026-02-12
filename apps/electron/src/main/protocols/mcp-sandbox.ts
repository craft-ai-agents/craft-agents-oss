/**
 * MCP Sandbox Protocol Handler
 *
 * Registers a custom `mcp-sandbox://` protocol that serves sandbox proxy HTML.
 * Each `mcp-sandbox://server-{hash}/proxy.html` gets a unique origin for isolation.
 *
 * Must call registerMcpSandboxScheme() before app.whenReady().
 * Must call setupMcpSandboxProtocol() after app.whenReady().
 */

import { protocol } from 'electron'

/**
 * The proxy HTML served by the mcp-sandbox:// protocol.
 * Adapted from SEP-1865 reference implementation.
 */
// SECURITY: The outer proxy CSP (in both the meta tag and response header) is intentionally
// permissive because the proxy only contains bootstrap JS that creates the inner iframe.
// The actual security boundary is the inner iframe's CSP built by buildCSP().
const PROXY_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src * data: blob: 'unsafe-inline'; media-src * blob: data:; font-src * blob: data:; script-src * 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * blob: data: 'unsafe-inline'; connect-src * data: blob: about:; frame-src * blob: data: http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*;"
    />
    <title>MCP Apps Sandbox Proxy</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
      * { box-sizing: border-box; }
      iframe { display: block; background-color: transparent; border: 0px none transparent; padding: 0px; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <script>
      function sanitizeDomain(domain) {
        if (typeof domain !== "string") return "";
        return domain.replace(/['"<>;]/g, "").trim();
      }

      function buildAllowAttribute(permissions) {
        if (!permissions) return "";
        var allowList = [];
        if (permissions.camera) allowList.push("camera *");
        if (permissions.microphone) allowList.push("microphone *");
        if (permissions.geolocation) allowList.push("geolocation *");
        if (permissions.clipboardWrite) allowList.push("clipboard-write *");
        return allowList.join("; ");
      }

      function buildCSP(csp) {
        if (!csp) {
          return [
            "default-src 'none'",
            "script-src 'unsafe-inline'",
            "style-src 'unsafe-inline'",
            "img-src data:",
            "font-src data:",
            "media-src data:",
            "connect-src 'none'",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'none'"
          ].join("; ");
        }

        var connectDomains = (csp.connectDomains || []).map(sanitizeDomain).filter(Boolean);
        var resourceDomains = (csp.resourceDomains || []).map(sanitizeDomain).filter(Boolean);
        var frameDomains = (csp.frameDomains || []).map(sanitizeDomain).filter(Boolean);
        var baseUriDomains = (csp.baseUriDomains || []).map(sanitizeDomain).filter(Boolean);

        var connectSrc = connectDomains.length > 0 ? connectDomains.join(" ") : "'none'";
        var resourceSrc = resourceDomains.length > 0
          ? ["data:", "blob:"].concat(resourceDomains).join(" ")
          : "data: blob:";
        var frameSrc = frameDomains.length > 0 ? frameDomains.join(" ") : "'none'";
        var baseUri = baseUriDomains.length > 0 ? baseUriDomains.join(" ") : "'none'";

        return [
          "default-src 'none'",
          "script-src 'unsafe-inline' " + resourceSrc,
          "style-src 'unsafe-inline' " + resourceSrc,
          "img-src " + resourceSrc,
          "font-src " + resourceSrc,
          "media-src " + resourceSrc,
          "connect-src " + connectSrc,
          "frame-src " + frameSrc,
          "object-src 'none'",
          "base-uri " + baseUri
        ].join("; ");
      }

      function buildViolationListenerScript() {
        return '<script>document.addEventListener("securitypolicyviolation", function(e) { var v = { type: "mcp-apps:csp-violation", directive: e.violatedDirective, blockedUri: e.blockedURI, sourceFile: e.sourceFile || null, lineNumber: e.lineNumber || null }; console.warn("[MCP Apps CSP Violation]", v.directive, ":", v.blockedUri); window.parent.postMessage(v, "*"); });<\\/script>';
      }

      function injectCSP(html, cspValue) {
        var cspMeta = '<meta http-equiv="Content-Security-Policy" content="' + cspValue + '">';
        var injection = cspMeta + buildViolationListenerScript();

        if (html.includes("<head>")) return html.replace("<head>", "<head>" + injection);
        if (html.includes("<HEAD>")) return html.replace("<HEAD>", "<HEAD>" + injection);
        if (html.includes("<html>")) return html.replace("<html>", "<html><head>" + injection + "</head>");
        if (html.includes("<HTML>")) return html.replace("<HTML>", "<HTML><head>" + injection + "</head>");
        if (html.includes("<!DOCTYPE") || html.includes("<!doctype")) {
          return html.replace(/(<!DOCTYPE[^>]*>|<!doctype[^>]*>)/i, "$1<head>" + injection + "</head>");
        }
        return injection + html;
      }

      var inner = document.createElement("iframe");
      inner.style = "width:100%; height:100%; border:none;";
      inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
      document.body.appendChild(inner);

      window.addEventListener("message", function(event) {
        if (event.source === window.parent) {
          if (event.data && event.data.method === "ui/notifications/sandbox-resource-ready") {
            var p = event.data.params || {};
            if (typeof p.sandbox === "string") inner.setAttribute("sandbox", p.sandbox);
            var allowAttr = buildAllowAttribute(p.permissions);
            if (allowAttr) inner.setAttribute("allow", allowAttr);
            if (typeof p.html === "string") {
              if (p.permissive) {
                // WARNING: Permissive CSP — for dev/testing only. Do not use in production.
                var permissiveCsp = [
                  "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: filesystem: about:",
                  "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
                  "style-src * 'unsafe-inline' data: blob:",
                  "img-src * data: blob: https: http:",
                  "media-src * data: blob: https: http:",
                  "font-src * data: blob: https: http:",
                  "connect-src * data: blob: https: http: ws: wss: about:",
                  "frame-src * data: blob: https: http: about:",
                  "object-src * data: blob:",
                  "base-uri *",
                  "form-action *"
                ].join("; ");
                inner.srcdoc = injectCSP(p.html, permissiveCsp);
              } else {
                inner.srcdoc = injectCSP(p.html, buildCSP(p.csp));
              }
            }
          } else {
            // SECURITY: '*' targetOrigin — inner iframe origin varies per sandbox configuration.
            if (inner && inner.contentWindow) inner.contentWindow.postMessage(event.data, "*");
          }
        } else if (event.source === inner.contentWindow) {
          // SECURITY: '*' targetOrigin — host origin varies per environment (e.g., file://, app://).
          window.parent.postMessage(event.data, "*");
        }
      });

      window.parent.postMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-proxy-ready",
        params: {}
      }, "*");
    </script>
  </body>
</html>`

/**
 * Register the mcp-sandbox:// scheme as privileged.
 * MUST be called before app.whenReady().
 */
export function registerMcpSandboxScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'mcp-sandbox',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

/**
 * Set up the mcp-sandbox:// protocol handler.
 * MUST be called after app.whenReady().
 */
export function setupMcpSandboxProtocol(): void {
  protocol.handle('mcp-sandbox', (_request) => {
    return new Response(PROXY_HTML, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // SECURITY: Response header CSP mirrors the meta tag CSP in PROXY_HTML.
        // Intentionally permissive — see comment above PROXY_HTML.
        'Content-Security-Policy':
          "default-src 'self'; img-src * data: blob: 'unsafe-inline'; media-src * blob: data:; font-src * blob: data:; script-src * 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * blob: data: 'unsafe-inline'; connect-src * data: blob: about:; frame-src * blob: data:;",
      },
    })
  })
}

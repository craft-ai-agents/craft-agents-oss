/**
 * Must be the FIRST script in <head>.
 *
 * Violations from <link> and inline <style> fire during parse, before any
 * script in <body> runs — a listener registered later would miss them and we
 * would silently under-report what CSP blocked.
 */
window.__WS0_VIOLATIONS__ = []
document.addEventListener('securitypolicyviolation', (e) => {
  window.__WS0_VIOLATIONS__.push({
    directive: e.effectiveDirective || e.violatedDirective,
    blockedURI: e.blockedURI,
    line: e.lineNumber,
  })
})

// Spike diagnostic: prove whether scripts execute at all inside the sandbox,
// in engines where we have no console/webRequest access. img-src 'self' is
// permitted even under connect-src 'none'.
window.__ws0beacon = function (stage) {
  try { new Image().src = '/internal/beacon?stage=' + encodeURIComponent(stage) + '&t=' + Date.now() } catch (e) {}
}
window.__ws0beacon('csp-probe-executed')

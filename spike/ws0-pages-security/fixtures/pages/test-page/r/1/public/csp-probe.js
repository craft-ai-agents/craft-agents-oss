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

// type="module" script. Verifies script-src 'self' covers module scripts,
// which load under different fetch semantics (CORS) than classic scripts —
// worth testing separately given the document origin is opaque.
window.__WS0_MODULE__ = true

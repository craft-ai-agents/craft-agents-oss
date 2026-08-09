/**
 * Data-as-JS.
 *
 * connect-src 'none' blocks fetch() entirely, including the page's own
 * data.json. So page data has to arrive as an executed script assigning a
 * global, not as fetched JSON. This is the pattern the authoring skill must
 * teach; app.js asserts both halves of it.
 */
window.__WS0_DATA__ = { source: 'app-data.js', rows: [1, 2, 3] }

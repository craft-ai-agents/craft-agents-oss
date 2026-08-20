// Shim for esbuild alias: sibling memory code imports "bun:sqlite"
// (Bun-only). Electron runs Node whose node:sqlite exposes the same
// DatabaseSync surface since Node 22.5.
module.exports = require('node:sqlite');

/**
 * Dev-only demo server for the Craft Pages playground entry.
 *
 *   bun run scripts/dev/craft-pages-demo.ts
 *   bun run playground:dev     # then open Markdown -> CraftPageBlock
 *
 * Serves a sample page through the REAL createPagesHandler on a fixed port, so
 * the playground has something to resolve. Only the transport and the
 * /demo-info discovery endpoint are demo-specific; the headers, CSP and
 * containment the browser sees are exactly what ships.
 */
process.env.CRAFT_FEATURE_CRAFT_PAGES = '1'
import { createServer } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { createPage } from '@craft-agent/session-tools-core'
import { PageCatalogService, createPagesHandler, sessionPagesRoot } from '@craft-agent/server-core/pages'

const PORT = 7777
const ws = '/tmp/craft-pages-playground-ws'
rmSync(ws, { recursive: true, force: true }); mkdirSync(ws, { recursive: true })
const pagesRoot = sessionPagesRoot(ws, 'demo-session'); mkdirSync(pagesRoot, { recursive: true })

const created = createPage(pagesRoot, { slug: 'pottery-studio', title: 'Wildflower Pottery', files: [
  { path: 'index.html', content: `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Wildflower Pottery</title><link rel="stylesheet" href="styles.css"></head><body>
<header><h1 id="title">Wildflower Pottery</h1><nav><a href="index.html">Home</a> · <a href="about.html">About</a></nav></header>
<main><p class="lede">Hand-thrown stoneware, fired in a wood kiln in the Mendips.</p>
<h2>Upcoming classes</h2><ul id="classes"></ul>
<h2>Glazes</h2><div id="gallery"></div>
<p id="diag" class="muted"></p></main>
<script src="data.js"></script><script src="app.js"></script></body></html>` },
  { path: 'about.html', content: `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><h1>About</h1><p class="lede">Relative navigation works.</p><a href="index.html">← Back</a></body></html>` },
  { path: 'styles.css', content: `:root{--ink:#2b2118;--clay:#a4552f;--bg:#faf6f0}
body{font:15px/1.6 ui-sans-serif,system-ui,sans-serif;margin:0;padding:24px;background:var(--bg);color:var(--ink)}
header{border-bottom:2px solid var(--clay);padding-bottom:10px;margin-bottom:16px}
h1{color:var(--clay);margin:0 0 4px;font-size:24px}h2{font-size:16px;margin:18px 0 6px}
nav a{color:var(--clay);text-decoration:none;font-size:13px}.lede{opacity:.85}
#classes{list-style:none;padding:0;margin:0}#classes li{padding:7px 11px;background:#fff;border:1px solid #e6dccf;border-radius:7px;margin-bottom:5px}
#gallery{display:flex;gap:7px}#gallery span{width:44px;height:44px;border-radius:7px;display:inline-block;border:1px solid #d9cbb9}
.muted{opacity:.65;font-size:13px;margin-top:16px}` },
  { path: 'data.js', content: `window.STUDIO={classes:["Beginner wheel — Tue 18:00","Glazing workshop — Sat 10:00","Raku firing — Sun 14:00"],glazes:["#7a9e7e","#a4552f","#c9b79c","#4a5f6a"]};` },
  { path: 'app.js', content: `(function(){var d=window.STUDIO;var ul=document.getElementById('classes');
d.classes.forEach(function(c){var li=document.createElement('li');li.textContent=c;ul.appendChild(li)});
var g=document.getElementById('gallery');d.glazes.forEach(function(h){var s=document.createElement('span');s.style.background=h;g.appendChild(s)});
var b=['origin='+window.origin];try{localStorage.setItem('x','1');b.push('localStorage=AVAILABLE')}catch(e){b.push('localStorage='+e.name)}
document.getElementById('diag').textContent=b.join('  ·  ');})();` },
]})

const catalog = new PageCatalogService(ws)
await catalog.register({ pageId: created.pageId, sessionId: 'demo-session', slug: 'pottery-studio', title: 'Wildflower Pottery' })
const handler = createPagesHandler({ catalog, workspaceRootPath: ws, getPort: () => PORT })

createServer(async (req, res) => {
  // Playground discovery endpoint (demo only, not part of the shipping handler).
  if ((req.url ?? '').startsWith('/demo-info')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    return res.end(JSON.stringify({ pageId: created.pageId, url: `http://127.0.0.1:${PORT}/w/${created.pageId}` }))
  }
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers as Record<string,string> })
  const r = await handler(request)
  const h: Record<string,string> = {}; r.headers.forEach((v,k)=>{h[k]=v})
  res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`demo on http://127.0.0.1:${PORT}`)
  console.log(`WRAPPER=http://127.0.0.1:${PORT}/w/${created.pageId}`)
})

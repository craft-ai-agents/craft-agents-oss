/**
 * Trusted wrapper logic. Runs on the pages origin, NOT sandboxed.
 *
 * The one rule that matters here: authenticate by `event.source`, never by
 * `event.origin`. A frame sandboxed without allow-same-origin has an opaque
 * origin, which postMessage serialises as the literal string "null" — so an
 * origin comparison never matches, and accepting "null" would accept a message
 * from ANY sandboxed frame on the page. This file records what origin it
 * actually saw so the ADR can cite a measurement rather than a claim.
 */
;(function () {
  const frame = document.getElementById('frame')
  const logEl = document.getElementById('log')
  const collected = { wrapper: {}, page: null }

  function emit() {
    // The Electron harness scrapes this line off the console.
    console.log('WS0_RESULTS:' + JSON.stringify(collected))
    logEl.textContent = JSON.stringify(collected, null, 2)
  }

  let forgeryRejected = null
  let sawOrigin = null

  window.addEventListener('message', function (e) {
    // ---- the guard under test ----
    const fromFrame = e.source === frame.contentWindow
    if (!fromFrame) {
      // Anything not from our frame is dropped. The self-posted forgery below
      // lands here, which is what proves the guard bites.
      if (e.data && e.data.ws0forgery) forgeryRejected = true
      return
    }

    const d = e.data
    if (!d || d.ws0 !== true) return
    sawOrigin = String(e.origin)

    if (d.kind === 'results') {
      collected.page = d.payload
      collected.wrapper.observedEventOrigin = sawOrigin
      collected.wrapper.originIsLiteralNull = sawOrigin === 'null'

      // ---- forgery test ----
      // Post to ourselves. e.source will be `window`, not frame.contentWindow,
      // so the guard above must drop it.
      forgeryRejected = false
      window.postMessage({ ws0: true, kind: 'results', ws0forgery: true, payload: 'FORGED' }, '*')

      setTimeout(function () {
        collected.wrapper.forgedMessageRejected = forgeryRejected === true
        collected.wrapper.pageStillHasRealResults = collected.page !== 'FORGED'
        // ---- destructive phase ----
        frame.contentWindow.postMessage({ ws0cmd: true, cmd: 'form-submit' }, '*')
      }, 50)
    }

    if (d.kind === 'self-nav-ack') {
      collected.wrapper.selfNavCommandReceivedByPage = true
      collected.wrapper.selfNavTarget = d.payload.target
    }
    if (d.kind === 'self-nav-threw') {
      collected.wrapper.selfNavThrew = d.payload
    }

    if (d.kind === 'form-result') {
      collected.wrapper.formSubmit = d.payload
      emit()
      // Self-navigation last: if it succeeds the frame is gone.
      setTimeout(function () {
        collected.wrapper.selfNavAttempted = true
        frame.contentWindow.postMessage({ ws0cmd: true, cmd: 'self-nav' }, '*')
        // Give the navigation a moment, then re-emit with the frame's final URL
        // as observed from the wrapper (cross-origin read will throw, which is
        // itself informative).
        setTimeout(function () {
          try {
            collected.wrapper.frameLocationAfterSelfNav = frame.contentWindow.location.href
          } catch (err) {
            collected.wrapper.frameLocationAfterSelfNav = 'unreadable:' + err.name
          }
          emit()
          console.log('WS0_DONE')
        }, 1200)
      }, 100)
    }
  })

  setTimeout(function () {
    if (!collected.page) {
      collected.wrapper.error = 'no results from frame within 8s'
      emit()
      console.log('WS0_DONE')
    }
  }, 8000)
})()

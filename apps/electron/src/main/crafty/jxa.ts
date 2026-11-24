import { execFile } from 'child_process'

/**
 * Crafty's macOS helpers, written in JXA and run with `osascript` (spike-grade: a process launch
 * per call, roughly 60–150 ms). They reach AppKit, Accessibility and CoreGraphics through JXA's
 * ObjC bridge. A small N-API addon replaces them at beta if latency or reliability needs it.
 *
 * Every script takes one JSON argument and prints one JSON result. The scripts are plain ES5 in
 * normal strings (no template literals), so they can't pick up TypeScript interpolation by accident.
 */

const OSASCRIPT = '/usr/bin/osascript'

export interface JxaRun<T> {
  value: T
  durationMs: number
}

function runJxa<T>(script: string, arg: unknown, timeoutMs: number): Promise<JxaRun<T>> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    execFile(
      OSASCRIPT,
      ['-l', 'JavaScript', '-e', script, JSON.stringify(arg ?? {})],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - started
        if (error) {
          const detail = (stderr || error.message).trim()
          reject(new Error(detail))
          return
        }
        try {
          resolve({ value: JSON.parse(stdout.trim()) as T, durationMs })
        } catch {
          reject(new Error(`Unexpected osascript output: ${stdout.trim().slice(0, 200)}`))
        }
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Frontmost app, focused window title, clipboard policy
// ---------------------------------------------------------------------------

const FRONTMOST_SCRIPT = [
  'function run(argv) {',
  '  ObjC.import("AppKit"); ObjC.import("ApplicationServices");',
  // The stock binding returns the window as a CFTypeRef that the next call refuses ("Ref has
  // incompatible type"). Bound with ids, the values chain and unwrap to strings (verified).
  '  ObjC.bindFunction("AXUIElementCopyAttributeValue", ["int", ["id", "id", "id *"]]);',
  '  var opts = JSON.parse(argv[0] || "{}");',
  '  var out = { pid: null, bundleId: null, appName: null, windowTitle: null, trusted: false, notes: [], pasteboard: null };',
  '  var app = opts.pid ? $.NSRunningApplication.runningApplicationWithProcessIdentifier(opts.pid) : $.NSWorkspace.sharedWorkspace.frontmostApplication;',
  '  if (!app || app.isNil()) { out.notes.push("app: not running"); return JSON.stringify(out); }',
  '  out.pid = Number(app.processIdentifier);',
  '  out.bundleId = ObjC.unwrap(app.bundleIdentifier) || null;',
  '  out.appName = ObjC.unwrap(app.localizedName) || null;',
  '  out.trusted = !!$.AXIsProcessTrusted();',
  '  if (opts.title) {',
  '    if (!out.trusted) { out.notes.push("window title: Accessibility not granted"); }',
  '    else {',
  '      try {',
  '        var el = ObjC.castRefToObject($.AXUIElementCreateApplication(out.pid));',
  '        var win = Ref();',
  '        var err = $.AXUIElementCopyAttributeValue(el, $("AXFocusedWindow"), win);',
  '        if (err !== 0) { out.notes.push("window title: AXFocusedWindow error " + err); }',
  '        else {',
  '          var title = Ref();',
  '          var err2 = $.AXUIElementCopyAttributeValue(win[0], $("AXTitle"), title);',
  '          if (err2 !== 0) { out.notes.push("window title: AXTitle error " + err2); }',
  '          else { out.windowTitle = unwrapString(title[0]); if (out.windowTitle === null) out.notes.push("window title: could not read the AXTitle value"); }',
  '        }',
  '      } catch (e) { out.notes.push("window title: " + e); }',
  '    }',
  '  }',
  '  if (opts.pasteboard) {',
  '    var pb = $.NSPasteboard.generalPasteboard;',
  '    var behavior = null;',
  '    try { behavior = pb.accessBehavior === undefined ? null : Number(pb.accessBehavior); } catch (e) { behavior = null; }',
  '    out.pasteboard = { changeCount: Number(pb.changeCount), accessBehavior: behavior };',
  '  }',
  '  return JSON.stringify(out);',
  '}',
  'function unwrapString(value) {',
  '  try { var s = ObjC.unwrap(value); if (typeof s === "string") return s; } catch (e) {}',
  '  try { var t = ObjC.unwrap(ObjC.castRefToObject(value)); if (typeof t === "string") return t; } catch (e) {}',
  '  return null;',
  '}',
].join('\n')

/**
 * `NSPasteboard.accessBehavior` (macOS 15.4+): 0 default, 1 ask, 2 always allow, 3 always deny.
 * Reading it never prompts; it tells us what a clipboard read would do.
 */
export interface PasteboardState {
  changeCount: number
  accessBehavior: number | null
}

export interface FrontmostInfo {
  pid: number | null
  bundleId: string | null
  appName: string | null
  windowTitle: string | null
  trusted: boolean
  notes: string[]
  pasteboard: PasteboardState | null
}

/** The frontmost app, or the app with `pid` (for probes). */
export function getFrontmostInfo(options: { title?: boolean; pasteboard?: boolean; pid?: number } = {}): Promise<JxaRun<FrontmostInfo>> {
  return runJxa<FrontmostInfo>(FRONTMOST_SCRIPT, options, 4000)
}

// ---------------------------------------------------------------------------
// Browser URL (Apple Events: needs the Automation grant per browser)
// ---------------------------------------------------------------------------

const SAFARI_BUNDLES = new Set(['com.apple.Safari', 'com.apple.SafariTechnologyPreview'])
const CHROMIUM_BUNDLES = new Set([
  'com.google.Chrome',
  'com.google.Chrome.canary',
  'com.brave.Browser',
  'com.microsoft.edgemac',
  'company.thebrowser.Browser',
  'com.vivaldi.Vivaldi',
  'com.operasoftware.Opera',
])

export function isBrowser(bundleId: string | null): boolean {
  return !!bundleId && (SAFARI_BUNDLES.has(bundleId) || CHROMIUM_BUNDLES.has(bundleId))
}

const BROWSER_URL_SCRIPT = [
  'function run(argv) {',
  '  var opts = JSON.parse(argv[0]);',
  '  var app = Application(opts.bundleId);',
  '  var url = opts.safari ? app.windows[0].currentTab.url() : app.windows[0].activeTab.url();',
  '  return JSON.stringify({ url: url || null });',
  '}',
].join('\n')

/**
 * The front browser window's URL. The first call per browser shows the Automation prompt and
 * blocks until it's answered, hence the long timeout; callers never wait on it for the panel.
 */
export function getBrowserUrl(bundleId: string): Promise<JxaRun<{ url: string | null }>> {
  return runJxa<{ url: string | null }>(BROWSER_URL_SCRIPT, { bundleId, safari: SAFARI_BUNDLES.has(bundleId) }, 30_000)
}

// ---------------------------------------------------------------------------
// Insert at the caret: type (Unicode key events) or paste (clipboard + ⌘V)
// ---------------------------------------------------------------------------

const INSERT_SCRIPT = [
  'function run(argv) {',
  '  ObjC.import("AppKit"); ObjC.import("CoreGraphics");',
  // The stock binding turns a JS string into a C string, so the event would carry garbage.
  // Bound with void*, it takes the UTF-16 bytes of an NSData (verified: accents, emoji).
  '  ObjC.bindFunction("CGEventKeyboardSetUnicodeString", ["void", ["void *", "unsigned long", "void *"]]);',
  '  var req = JSON.parse(argv[0]);',
  '  var out = { ok: false, mode: req.mode, reactivated: false, clipboardRestored: null, accessBehavior: null };',
  '  var ws = $.NSWorkspace.sharedWorkspace;',
  '  function spin(seconds) { $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(seconds)); }',
  '  function frontPid() { spin(0); return Number(ws.frontmostApplication.processIdentifier); }',
  '  out.frontBefore = frontPid();',
  '  if (req.pid && out.frontBefore !== req.pid) {',
  '    var target = $.NSRunningApplication.runningApplicationWithProcessIdentifier(req.pid);',
  '    if (!target || target.isNil()) { out.error = "The app you came from is no longer running"; return JSON.stringify(out); }',
  '    target.activateWithOptions(2);',
  '    for (var i = 0; i < 40 && frontPid() !== req.pid; i++) spin(0.025);',
  '    out.reactivated = true;',
  '    out.frontAfter = frontPid();',
  '    if (out.frontAfter !== req.pid) { out.error = "Could not bring the app you came from back to the front"; return JSON.stringify(out); }',
  '    spin(0.08);',
  '  }',
  '  function post(ev) { $.CGEventPost(0, ev); }',
  '  function key(code, down, flags) { var ev = $.CGEventCreateKeyboardEvent($(), code, down); $.CGEventSetFlags(ev, flags); post(ev); }',
  '  if (req.mode === "type") {',
  '    var text = req.text; var i0 = 0;',
  '    while (i0 < text.length) {',
  // At most 20 UTF-16 units per event (what apps read), never splitting a surrogate pair.
  '      var end = Math.min(i0 + 20, text.length);',
  '      if (end < text.length) { var c = text.charCodeAt(end - 1); if (c >= 0xD800 && c <= 0xDBFF) end--; }',
  '      var data = $(text.slice(i0, end)).dataUsingEncoding($.NSUTF16LittleEndianStringEncoding);',
  '      var units = Number(data.length) / 2;',
  '      var down = $.CGEventCreateKeyboardEvent($(), 0, true); $.CGEventSetFlags(down, 0);',
  '      $.CGEventKeyboardSetUnicodeString(down, units, data.bytes); post(down);',
  '      var up = $.CGEventCreateKeyboardEvent($(), 0, false); $.CGEventSetFlags(up, 0);',
  '      $.CGEventKeyboardSetUnicodeString(up, units, data.bytes); post(up);',
  '      delay(0.004);',
  '      i0 = end;',
  '    }',
  '    out.ok = true;',
  '    return JSON.stringify(out);',
  '  }',
  '  var pb = $.NSPasteboard.generalPasteboard;',
  '  try { out.accessBehavior = pb.accessBehavior === undefined ? null : Number(pb.accessBehavior); } catch (e) {}',
  // Save the clipboard only when reading it can't prompt: policy "always allow", or a macOS
  // without the policy (before 15.4).
  '  var saved = null;',
  '  if (req.restore && (out.accessBehavior === null || out.accessBehavior === 2)) saved = saveClipboard(pb);',
  '  pb.clearContents;',
  '  var item = $.NSPasteboardItem.alloc.init;',
  '  item.setStringForType($(req.text), $.NSPasteboardTypeString);',
  // nspasteboard.org markers: clipboard managers skip transient, generated items.
  '  item.setDataForType($.NSData.data, "org.nspasteboard.TransientType");',
  '  item.setDataForType($.NSData.data, "org.nspasteboard.AutoGeneratedType");',
  '  pb.writeObjects($.NSArray.arrayWithObject(item));',
  '  var ours = Number(pb.changeCount);',
  '  key(9, true, 1048576); key(9, false, 1048576);',
  '  out.ok = true;',
  '  if (saved) {',
  '    delay(req.restoreDelayMs / 1000);',
  '    if (Number(pb.changeCount) === ours) { restoreClipboard(pb, saved); out.clipboardRestored = true; }',
  '    else { out.clipboardRestored = false; }',
  '  }',
  '  return JSON.stringify(out);',
  '}',
  'function saveClipboard(pb) {',
  '  var saved = []; var items = pb.pasteboardItems;',
  '  if (!items || items.isNil()) return saved;',
  '  for (var i = 0; i < Number(items.count); i++) {',
  '    var it = items.objectAtIndex(i); var types = it.types; var entry = [];',
  '    for (var j = 0; j < Number(types.count); j++) {',
  '      var type = types.objectAtIndex(j); var data = it.dataForType(type);',
  '      if (data && !data.isNil()) entry.push([type, data]);',
  '    }',
  '    saved.push(entry);',
  '  }',
  '  return saved;',
  '}',
  'function restoreClipboard(pb, saved) {',
  '  pb.clearContents;',
  '  if (!saved.length) return;',
  '  var items = $.NSMutableArray.array;',
  '  saved.forEach(function (entry) {',
  '    var it = $.NSPasteboardItem.alloc.init;',
  '    entry.forEach(function (pair) { it.setDataForType(pair[1], pair[0]); });',
  '    items.addObject(it);',
  '  });',
  '  pb.writeObjects(items);',
  '}',
].join('\n')

export interface InsertScriptResult {
  ok: boolean
  mode: 'type' | 'paste'
  error?: string
  reactivated: boolean
  frontBefore?: number
  frontAfter?: number
  clipboardRestored: boolean | null
  accessBehavior: number | null
}

export function insertText(request: {
  pid: number | null
  text: string
  mode: 'type' | 'paste'
  restore: boolean
  restoreDelayMs: number
}): Promise<JxaRun<InsertScriptResult>> {
  return runJxa<InsertScriptResult>(INSERT_SCRIPT, request, 15_000)
}

/** The script sources, so a check can compile them with `osacompile` without running them. */
export const JXA_SCRIPTS = { frontmost: FRONTMOST_SCRIPT, browserUrl: BROWSER_URL_SCRIPT, insert: INSERT_SCRIPT }

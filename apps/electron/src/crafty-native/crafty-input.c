/*
 * Crafty native input (spike): an N-API addon, loaded by Crafty's native host (host.ts) from
 * dist/native/crafty-input.node. macOS only. Built with crafty-pasteboard.m by
 * scripts/build/crafty-input.ts (compileCraftyInput), from scripts/electron-build-main.ts and
 * scripts/electron-dev.ts.
 *
 * start(onEvent)     An active CGEventTap on modifier changes only (flagsChanged): it never sees
 *                    typed characters. Active rather than listen-only because Accessibility covers
 *                    an active tap, while a listen-only keyboard tap needs Input Monitoring. The tap
 *                    passes every event on unchanged. It runs on its own thread and run loop: an
 *                    active tap holds up each event until its callback returns, so it must never
 *                    wait on the JS thread. Each event carries the time since the last key press and
 *                    click (CGEventSourceSecondsSinceLastEventType), which the double-tap detector
 *                    (main/crafty/trigger-detect.ts) uses to tell ⌘ ⌘ from ⌘C ⌘V without watching
 *                    keys. macOS disables a tap whose callback is too slow; this one turns itself
 *                    back on. It stops when Accessibility is revoked: an active tap left behind can
 *                    hold up input.
 * stop()             Stops the tap and joins its thread.
 * running()          Whether the tap is on.
 * isTrusted()        Accessibility, without a prompt.
 * warp(x, y)         Moves the pointer (global coordinates, points). No event is posted.
 * focusedEditable(pid)  Whether the app's focused element takes text, for Replace vs Copy. Asked
 *                    of the app itself: a helper process can't read the system-wide focused element
 *                    (kAXErrorCannotComplete), and an app keeps its own focus while a Crafty panel
 *                    is key, so the answer holds after Crafty opens.
 * copySelection(timeoutMs)  ⌘C to the frontmost app, for a selection Accessibility can't read: the
 *                    text counts only if the pasteboard changed after it, and the previous
 *                    clipboard is put back (crafty-pasteboard.m).
 *
 * Events to onEvent:
 *   { type: 'flags', keyCode, flags, at, sinceKeyMs, sinceClickMs }
 *   { type: 'tap', state, at }   state: 're-enabled' | 'stopped-untrusted'
 * `at` is a monotonic clock in ms (CLOCK_UPTIME_RAW), the same for every event.
 */

#define NAPI_VERSION 8
#include <node_api.h>

#include <ApplicationServices/ApplicationServices.h>
#include <dispatch/dispatch.h>
#include <math.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  bool isTapState;
  int keyCode;
  double flags;
  double at;
  double sinceKeyMs;
  double sinceClickMs;
  /* A static string, for tap state events. */
  const char *state;
} InputEvent;

/* One tap per process. Written by the JS thread only while the tap thread isn't running. */
static napi_threadsafe_function g_tsfn = NULL;
static pthread_t g_thread;
static bool g_threadStarted = false;
static dispatch_semaphore_t g_startedSignal = NULL;
static bool g_startOk = false;
static pid_t g_pid = 0;

/* Shared with the tap thread. */
static volatile bool g_stopRequested = false;
static CFRunLoopRef g_runLoop = NULL;
static CFMachPortRef g_tap = NULL;

static const double WATCHDOG_INTERVAL_S = 2.0;
static const int64_t START_TIMEOUT_NS = 2 * NSEC_PER_SEC;
/* Bounded, and never blocking: when JS falls behind, events are dropped rather than queued up. */
static const size_t EVENT_QUEUE_SIZE = 256;

static double nowMs(void) {
  return (double)clock_gettime_nsec_np(CLOCK_UPTIME_RAW) / 1e6;
}

static double sinceMs(CGEventType type) {
  return CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateHIDSystemState, type) * 1000.0;
}

static void postEvent(InputEvent event) {
  if (!g_tsfn) return;
  InputEvent *copy = malloc(sizeof *copy);
  if (!copy) return;
  *copy = event;
  if (napi_call_threadsafe_function(g_tsfn, copy, napi_tsfn_nonblocking) != napi_ok) free(copy);
}

static void postTapState(const char *state) {
  InputEvent event = {0};
  event.isTapState = true;
  event.state = state;
  event.at = nowMs();
  postEvent(event);
}

static CGEventRef onTapEvent(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *info) {
  (void)proxy;
  (void)info;
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (g_tap) CGEventTapEnable(g_tap, true);
    postTapState("re-enabled");
    return event;
  }
  if (type != kCGEventFlagsChanged) return event;
  /* Events this process posted (selection-hook's ⌘C posts keys, never modifiers, but stay safe) */
  if ((pid_t)CGEventGetIntegerValueField(event, kCGEventSourceUnixProcessID) == g_pid) return event;
  InputEvent input = {0};
  input.keyCode = (int)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  input.flags = (double)CGEventGetFlags(event);
  input.at = nowMs();
  input.sinceKeyMs = sinceMs(kCGEventKeyDown);
  input.sinceClickMs = fmin(sinceMs(kCGEventLeftMouseDown), fmin(sinceMs(kCGEventRightMouseDown), sinceMs(kCGEventOtherMouseDown)));
  postEvent(input);
  return event;
}

static void onWatchdog(CFRunLoopTimerRef timer, void *info) {
  (void)timer;
  (void)info;
  if (AXIsProcessTrusted()) return;
  if (g_tap) CGEventTapEnable(g_tap, false);
  g_stopRequested = true;
  postTapState("stopped-untrusted");
  CFRunLoopStop(CFRunLoopGetCurrent());
}

static void *runTap(void *arg) {
  (void)arg;
  CFMachPortRef tap = CGEventTapCreate(
    kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault,
    CGEventMaskBit(kCGEventFlagsChanged), onTapEvent, NULL);
  if (!tap) {
    g_startOk = false;
    dispatch_semaphore_signal(g_startedSignal);
    return NULL;
  }
  CFRunLoopRef loop = CFRunLoopGetCurrent();
  CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
  CFRunLoopAddSource(loop, source, kCFRunLoopCommonModes);
  CFRunLoopTimerRef watchdog = CFRunLoopTimerCreate(
    kCFAllocatorDefault, CFAbsoluteTimeGetCurrent() + WATCHDOG_INTERVAL_S, WATCHDOG_INTERVAL_S, 0, 0, onWatchdog, NULL);
  CFRunLoopAddTimer(loop, watchdog, kCFRunLoopCommonModes);
  g_tap = tap;
  /* Released by stopTap() after the join, so a late CFRunLoopStop never touches a freed loop */
  g_runLoop = (CFRunLoopRef)CFRetain(loop);
  CGEventTapEnable(tap, true);
  g_startOk = true;
  dispatch_semaphore_signal(g_startedSignal);

  /* In slices, so a stop() that lands before the loop starts running isn't lost */
  while (!g_stopRequested) CFRunLoopRunInMode(kCFRunLoopDefaultMode, 1.0, false);

  CGEventTapEnable(tap, false);
  g_tap = NULL;
  CFRunLoopTimerInvalidate(watchdog);
  CFRelease(watchdog);
  CFRunLoopRemoveSource(loop, source, kCFRunLoopCommonModes);
  CFRelease(source);
  CFMachPortInvalidate(tap);
  CFRelease(tap);
  return NULL;
}

/* The JS thread: turns an event into an object for the callback. */
static void callJs(napi_env env, napi_value callback, void *context, void *data) {
  (void)context;
  InputEvent *event = data;
  if (env && callback) {
    napi_value object, value, undefined;
    napi_create_object(env, &object);
    if (event->isTapState) {
      napi_create_string_utf8(env, "tap", NAPI_AUTO_LENGTH, &value);
      napi_set_named_property(env, object, "type", value);
      napi_create_string_utf8(env, event->state, NAPI_AUTO_LENGTH, &value);
      napi_set_named_property(env, object, "state", value);
    } else {
      napi_create_string_utf8(env, "flags", NAPI_AUTO_LENGTH, &value);
      napi_set_named_property(env, object, "type", value);
      napi_create_int32(env, event->keyCode, &value);
      napi_set_named_property(env, object, "keyCode", value);
      napi_create_double(env, event->flags, &value);
      napi_set_named_property(env, object, "flags", value);
      napi_create_double(env, event->sinceKeyMs, &value);
      napi_set_named_property(env, object, "sinceKeyMs", value);
      napi_create_double(env, event->sinceClickMs, &value);
      napi_set_named_property(env, object, "sinceClickMs", value);
    }
    napi_create_double(env, event->at, &value);
    napi_set_named_property(env, object, "at", value);
    napi_get_undefined(env, &undefined);
    napi_call_function(env, undefined, callback, 1, &object, NULL);
  }
  free(event);
}

static void stopTap(void) {
  if (!g_threadStarted) return;
  g_stopRequested = true;
  CFRunLoopRef loop = g_runLoop;
  if (loop) {
    CFRunLoopStop(loop);
    CFRunLoopWakeUp(loop);
  }
  pthread_join(g_thread, NULL);
  g_threadStarted = false;
  if (g_runLoop) {
    CFRelease(g_runLoop);
    g_runLoop = NULL;
  }
  if (g_startedSignal) {
    dispatch_release(g_startedSignal);
    g_startedSignal = NULL;
  }
  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = NULL;
  }
}

static napi_value boolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_valuetype type = napi_undefined;
  if (argc >= 1) napi_typeof(env, argv[0], &type);
  if (type != napi_function) {
    napi_throw_type_error(env, NULL, "start(onEvent) needs a callback");
    return NULL;
  }
  /* Already on; or the watchdog stopped it, and its thread waits to be joined */
  if (g_threadStarted && !g_stopRequested) return boolean(env, true);
  stopTap();
  /* Never create the tap untrusted: no prompt, and nothing that could hold up input */
  if (!AXIsProcessTrusted()) return boolean(env, false);

  napi_value name;
  napi_create_string_utf8(env, "crafty-input", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, argv[0], NULL, name, EVENT_QUEUE_SIZE, 1, NULL, NULL, NULL, callJs, &g_tsfn) != napi_ok) {
    napi_throw_error(env, NULL, "Could not create the event channel");
    return NULL;
  }
  /* The host's message port keeps the process alive, not the tap */
  napi_unref_threadsafe_function(env, g_tsfn);

  g_stopRequested = false;
  g_startOk = false;
  g_startedSignal = dispatch_semaphore_create(0);
  if (pthread_create(&g_thread, NULL, runTap, NULL) != 0) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = NULL;
    napi_throw_error(env, NULL, "Could not start the tap thread");
    return NULL;
  }
  g_threadStarted = true;
  long timedOut = dispatch_semaphore_wait(g_startedSignal, dispatch_time(DISPATCH_TIME_NOW, START_TIMEOUT_NS));
  if (timedOut || !g_startOk) {
    stopTap();
    return boolean(env, false);
  }
  return boolean(env, true);
}

static napi_value Stop(napi_env env, napi_callback_info info) {
  (void)info;
  stopTap();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value Running(napi_env env, napi_callback_info info) {
  (void)info;
  return boolean(env, g_threadStarted && !g_stopRequested);
}

static napi_value IsTrusted(napi_env env, napi_callback_info info) {
  (void)info;
  return boolean(env, AXIsProcessTrusted());
}

static napi_value Warp(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  double x = NAN, y = NAN;
  if (argc >= 2) {
    napi_get_value_double(env, argv[0], &x);
    napi_get_value_double(env, argv[1], &y);
  }
  if (!isfinite(x) || !isfinite(y)) {
    napi_throw_type_error(env, NULL, "warp(x, y) needs two numbers");
    return NULL;
  }
  CGError error = CGWarpMouseCursorPosition(CGPointMake(x, y));
  /* A warp suppresses pointer movement for ~250 ms unless it's re-associated at once */
  CGAssociateMouseAndMouseCursorPosition(true);
  return boolean(env, error == kCGErrorSuccess);
}

static bool isSettable(AXUIElementRef element, CFStringRef attribute) {
  Boolean settable = false;
  return AXUIElementIsAttributeSettable(element, attribute, &settable) == kAXErrorSuccess && settable;
}

static void setString(napi_env env, napi_value object, const char *key, CFStringRef string) {
  napi_value value;
  char buffer[128];
  if (string && CFStringGetCString(string, buffer, sizeof buffer, kCFStringEncodingUTF8)) {
    napi_create_string_utf8(env, buffer, NAPI_AUTO_LENGTH, &value);
  } else {
    napi_get_null(env, &value);
  }
  napi_set_named_property(env, object, key, value);
}

/* { editable, role, subrole, error }: error is null or the AXError number */
static napi_value FocusedEditable(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t pid = 0;
  if (argc < 1 || napi_get_value_int32(env, argv[0], &pid) != napi_ok || pid <= 0) {
    napi_throw_type_error(env, NULL, "focusedEditable(pid) needs a process id");
    return NULL;
  }
  napi_value result, value;
  napi_create_object(env, &result);
  bool editable = false;
  CFStringRef role = NULL, subrole = NULL;
  AXError error = kAXErrorAPIDisabled;
  if (AXIsProcessTrusted()) {
    AXUIElementRef app = AXUIElementCreateApplication((pid_t)pid);
    /* Its elements inherit it; a busy app answers "cannot complete" instead of stalling Crafty */
    AXUIElementSetMessagingTimeout(app, 0.25f);
    CFTypeRef focused = NULL;
    error = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute, &focused);
    if (error == kAXErrorSuccess && focused && CFGetTypeID(focused) == AXUIElementGetTypeID()) {
      AXUIElementRef element = (AXUIElementRef)focused;
      CFTypeRef value = NULL;
      if (AXUIElementCopyAttributeValue(element, kAXRoleAttribute, &value) == kAXErrorSuccess && value && CFGetTypeID(value) == CFStringGetTypeID()) role = value;
      else if (value) CFRelease(value);
      value = NULL;
      if (AXUIElementCopyAttributeValue(element, kAXSubroleAttribute, &value) == kAXErrorSuccess && value && CFGetTypeID(value) == CFStringGetTypeID()) subrole = value;
      else if (value) CFRelease(value);
      editable = isSettable(element, kAXValueAttribute)
        || isSettable(element, kAXSelectedTextAttribute)
        || isSettable(element, kAXSelectedTextRangeAttribute);
    }
    if (focused) CFRelease(focused);
    CFRelease(app);
  }
  napi_set_named_property(env, result, "editable", boolean(env, editable));
  setString(env, result, "role", role);
  setString(env, result, "subrole", subrole);
  if (error == kAXErrorSuccess) napi_get_null(env, &value);
  else napi_create_int32(env, (int32_t)error, &value);
  napi_set_named_property(env, result, "error", value);
  if (role) CFRelease(role);
  if (subrole) CFRelease(subrole);
  return result;
}

/* crafty-pasteboard.m */
napi_value CraftyCopySelection(napi_env env, napi_callback_info info);

static void onEnvCleanup(void *arg) {
  (void)arg;
  stopTap();
}

static void exportFunction(napi_env env, napi_value exports, const char *name, napi_callback callback) {
  napi_value fn;
  napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, NULL, &fn);
  napi_set_named_property(env, exports, name, fn);
}

NAPI_MODULE_INIT() {
  g_pid = getpid();
  exportFunction(env, exports, "start", Start);
  exportFunction(env, exports, "stop", Stop);
  exportFunction(env, exports, "running", Running);
  exportFunction(env, exports, "isTrusted", IsTrusted);
  exportFunction(env, exports, "warp", Warp);
  exportFunction(env, exports, "focusedEditable", FocusedEditable);
  exportFunction(env, exports, "copySelection", CraftyCopySelection);
  napi_add_env_cleanup_hook(env, onEnvCleanup, NULL);
  return exports;
}

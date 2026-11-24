/*
 * Crafty's ⌘C fallback (spike), compiled into crafty-input.node with crafty-input.c, which exports
 * it as copySelection (scripts/build/crafty-input.ts). For apps whose selection Accessibility
 * can't read.
 *
 * It takes text only when the pasteboard changed after its own ⌘C, so whatever was on the
 * clipboard before never passes for the selection. selection-hook's fallback, which it replaces,
 * reads the clipboard without copying whenever it changed since the last mouse-down it saw;
 * Crafty never starts selection-hook's input hooks, so it never sees one, and the last thing
 * copied came back as the selection on every later open.
 *
 * The ⌘C and the restore follow selection-hook's (src/mac/core/engine.mm): every type of every
 * item is saved before, and put back once the app has copied.
 */

#import <AppKit/AppKit.h>
#include <math.h>
#include <node_api.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

/* kVK_ANSI_C, from Carbon's HIToolbox/Events.h */
static const CGKeyCode KEY_C = 8;
static const int POLL_MS = 10;
static const int DEFAULT_TIMEOUT_MS = 100;

static double nowMs(void) {
  return (double)clock_gettime_nsec_np(CLOCK_UPTIME_RAW) / 1e6;
}

/* Every item with every type it can give now: NSPasteboardItems go stale once the pasteboard is cleared */
static NSArray<NSPasteboardItem *> *saveItems(NSPasteboard *pasteboard) {
  NSMutableArray<NSPasteboardItem *> *items = [NSMutableArray array];
  for (NSPasteboardItem *item in pasteboard.pasteboardItems) {
    NSPasteboardItem *copy = [[NSPasteboardItem alloc] init];
    for (NSPasteboardType type in item.types) {
      NSData *data = [item dataForType:type];
      /* nil: a promise the source app can't keep */
      if (data) [copy setData:data forType:type];
    }
    if (copy.types.count) [items addObject:copy];
  }
  return items;
}

/* Posted to the app, not the HID stream, so no other app gets it; down and up stay apart */
static bool postCopy(pid_t pid) {
  CGEventRef down = CGEventCreateKeyboardEvent(NULL, KEY_C, true);
  CGEventRef up = CGEventCreateKeyboardEvent(NULL, KEY_C, false);
  bool ok = down && up;
  if (ok) {
    CGEventSetFlags(down, kCGEventFlagMaskCommand);
    CGEventSetFlags(up, kCGEventFlagMaskCommand);
    CGEventPostToPid(pid, down);
    usleep(5 * 1000);
    CGEventPostToPid(pid, up);
  }
  if (down) CFRelease(down);
  if (up) CFRelease(up);
  return ok;
}

static void setValue(napi_env env, napi_value object, const char *key, napi_value value) {
  napi_set_named_property(env, object, key, value);
}

static void setBool(napi_env env, napi_value object, const char *key, bool flag) {
  napi_value value;
  napi_get_boolean(env, flag, &value);
  setValue(env, object, key, value);
}

static void setString(napi_env env, napi_value object, const char *key, NSString *string) {
  napi_value value;
  if (string) {
    const char *utf8 = string.UTF8String;
    napi_create_string_utf8(env, utf8, strlen(utf8), &value);
  } else {
    napi_get_null(env, &value);
  }
  setValue(env, object, key, value);
}

/*
 * copySelection(timeoutMs = 100) → { text, pid, bundleId, posted, copied, restored, ms }
 * text: what the frontmost app copied, or null (nothing copied, no plain text, or only whitespace).
 * posted: the ⌘C went out (Accessibility on, an app in front). copied: the pasteboard changed within
 * timeoutMs. restored: the previous items are back.
 */
napi_value CraftyCopySelection(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t timeoutMs = DEFAULT_TIMEOUT_MS;
  if (argc < 1 || napi_get_value_int32(env, argv[0], &timeoutMs) != napi_ok) timeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutMs < POLL_MS) timeoutMs = POLL_MS;
  if (timeoutMs > 1000) timeoutMs = 1000;

  double started = nowMs();
  napi_value result;
  napi_create_object(env, &result);
  @autoreleasepool {
    /* NSWorkspace hears about app switches through the run loop, which nothing else spins here */
    [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate distantPast]];
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    pid_t pid = app ? app.processIdentifier : 0;
    NSString *text = nil;
    bool posted = false, copied = false, restored = false;

    if (pid > 0 && pid != getpid() && AXIsProcessTrusted()) {
      NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
      NSInteger before = pasteboard.changeCount;
      NSArray<NSPasteboardItem *> *saved = saveItems(pasteboard);
      posted = postCopy(pid);
      for (int waited = 0; posted && waited < timeoutMs; waited += POLL_MS) {
        usleep(POLL_MS * 1000);
        if (pasteboard.changeCount != before) {
          copied = true;
          break;
        }
      }
      if (copied) {
        NSString *string = [pasteboard stringForType:NSPasteboardTypeString];
        if (!string) {
          /* The change count moves when the app clears the pasteboard, a moment before it writes */
          usleep(POLL_MS * 1000);
          string = [pasteboard stringForType:NSPasteboardTypeString];
        }
        NSString *trimmed = [string stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (trimmed.length) text = string;
        [pasteboard clearContents];
        restored = saved.count == 0 || [pasteboard writeObjects:saved];
      }
    }

    setString(env, result, "text", text);
    napi_value value;
    napi_create_int32(env, (int32_t)pid, &value);
    setValue(env, result, "pid", value);
    setString(env, result, "bundleId", app.bundleIdentifier);
    setBool(env, result, "posted", posted);
    setBool(env, result, "copied", copied);
    setBool(env, result, "restored", restored);
  }
  napi_value ms;
  napi_create_double(env, round((nowMs() - started) * 10) / 10, &ms);
  setValue(env, result, "ms", ms);
  return result;
}

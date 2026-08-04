# React 18 Integration Patterns for Electron

React 18 runs in Electron's Chromium-based renderer with full access to
concurrent features, Suspense, and `createRoot`. The desktop context adds
concerns web apps rarely face: IPC listener lifecycle, long-running processes,
multi-window awareness, and error reporting to the main process.

---

## Entry Point and Strict Mode

`createRoot` works without modification. Always wrap in `StrictMode` during
development -- its double-invocation catches IPC listener leaks that would
otherwise accumulate silently in long-running desktop apps.

```typescript
// renderer/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Concurrent features (`useTransition`, `useDeferredValue`, automatic batching)
work normally. The renderer is a full Chromium instance with the same JS engine
and event loop as Chrome.

---

## IPC Listener Cleanup -- The Critical Pattern

Strict Mode mounts components twice in dev, exposing effects that fail to clean
up. In Electron, leaked IPC listeners persist for the app lifetime.

```typescript
// BAD: Missing cleanup -- duplicates on every re-mount
function CounterDisplay() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    window.electronAPI.onUpdateCounter((value) => setCount(value));
    // No cleanup returned!
  }, []);
  return <div>Count: {count}</div>;
}
```

```typescript
// GOOD: Cleanup prevents listener leaks
function CounterDisplay() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const cleanup = window.electronAPI.onUpdateCounter((value) => {
      setCount(value);
    });
    return cleanup; // Strict Mode's double-invoke verifies this works
  }, []);
  return <div>Count: {count}</div>;
}
```

The preload must return an unsubscribe function from every `on`-style listener.
See [Context Isolation](../security/context-isolation.md) for the preload side.

A reusable hook simplifies multi-listener components:

```typescript
function useIpcListener<T>(
  subscribe: (cb: (value: T) => void) => () => void,
  onValue: (value: T) => void,
  deps: React.DependencyList = []
) {
  useEffect(() => {
    const cleanup = subscribe(onValue);
    return cleanup;
  }, deps);
}

// Usage
function DownloadIndicator() {
  const [progress, setProgress] = useState(0);
  useIpcListener(window.electronAPI.onDownloadProgress, setProgress);
  return <ProgressBar value={progress} />;
}
```

```typescript
// Multiple listeners with combined cleanup
function StatusBar() {
  const [online, setOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState('idle');
  useEffect(() => {
    const c1 = window.electronAPI.onConnectivityChange(setOnline);
    const c2 = window.electronAPI.onSyncStatusChange(setSyncStatus);
    return () => { c1(); c2(); };
  }, []);
  return <footer>{online ? 'Online' : 'Offline'} | Sync: {syncStatus}</footer>;
}
```

---

## HMR with electron-vite

`electron-vite` provides Vite-based HMR with React Fast Refresh. Main and
preload are rebuilt on change without a full app restart.

```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }, // Enables Fast Refresh
});
```

Fast Refresh re-runs effects on every save. Correct cleanup means seamless HMR;
missing cleanup means listeners double with every save.

---

## Error Boundaries for Desktop

In a web app, errors yield a white screen fixable by refresh. Desktop apps have
no refresh -- error boundaries are essential, and they should report to main.

```typescript
class ElectronErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    window.electronAPI.reportError({
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          onReset={() => this.setState({ hasError: false })}
        />
      );
    }
    return this.props.children;
  }
}
```

Use boundaries at multiple levels -- root for catastrophic failures, and
feature-level around panels to isolate crashes:

```typescript
function App() {
  return (
    <ElectronErrorBoundary>
      <Layout>
        <ElectronErrorBoundary fallback={<SidebarFallback />}>
          <Sidebar />
        </ElectronErrorBoundary>
        <ElectronErrorBoundary fallback={<EditorFallback />}>
          <Editor />
        </ElectronErrorBoundary>
      </Layout>
    </ElectronErrorBoundary>
  );
}
```

---

## Suspense and Lazy Loading

Use `React.lazy` with `Suspense` to split heavy components, reducing initial
window paint time. Electron loads from disk so the split is fast -- the benefit
is less JavaScript to parse before first paint, not less download.

```typescript
const Settings = React.lazy(() => import('./pages/Settings'));
const Editor = React.lazy(() => import('./pages/Editor'));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </Suspense>
  );
}
```

---

## Window Focus, Lifecycle, and Memory

```typescript
// Window focus awareness -- throttle work when unfocused
function useWindowFocus(): boolean {
  const [isFocused, setIsFocused] = useState(document.hasFocus());
  useEffect(() => {
    const onFocus = () => setIsFocused(true);
    const onBlur = () => setIsFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return isFocused;
}
```

```typescript
// Unsaved changes guard
function useBeforeUnload(shouldBlock: () => boolean) {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (shouldBlock()) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [shouldBlock]);
}
```

**Memory leak sources in long-running Electron apps:**

1. **IPC listeners without cleanup** -- most common; always return unsubscribe.
2. **Stale closures in timers** -- `setInterval` capturing old state.
3. **Uncancelled async ops** -- use a `cancelled` flag in effect cleanup.
4. **Large objects in state** -- pass file buffers through IPC on demand.

```typescript
// Cancellable async pattern
function FileLoader({ filePath }: { filePath: string }) {
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.readFile(filePath).then((data) => {
      if (!cancelled) setContent(data);
    });
    return () => { cancelled = true; };
  }, [filePath]);
  return content ? <pre>{content}</pre> : <p>Loading...</p>;
}
```

Monitor with Chromium DevTools heap snapshots (`Ctrl+Shift+I`). Growing
retained size across snapshots indicates a leak.

---

## See Also

- [State Management](./state-management.md) -- Zustand, electron-store, and
  cross-window state synchronization patterns.
- [Multi-Window State](../architecture/multi-window-state.md) -- Architecture
  for managing state across multiple Electron windows.
- [Context Isolation](../security/context-isolation.md) -- Preload script
  patterns that enable the cleanup functions used by React effects.
- [Typed IPC](../ipc/typed-ipc.md) -- Type-safe IPC channel definitions that
  pair with the React hooks shown in this reference.

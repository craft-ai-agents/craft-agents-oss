# React Renderer Entry Point Template

This template provides a React 18 renderer entry point for Electron applications. It includes an error boundary that catches rendering failures gracefully, `StrictMode` for catching common development issues, and a `Suspense` wrapper for lazy-loaded components. The structure is ready for adding routing, state management, and your application components.

```tsx
/**
 * React Renderer Entry Point
 *
 * React 18 createRoot with:
 * - StrictMode for development
 * - Error boundary for production
 * - Type-safe electronAPI usage
 *
 * TODO: Add your routes
 * TODO: Customize error boundary fallback
 * TODO: Add state management provider if needed
 */

import React, { Component, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

// === Error Boundary ===
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Report error to main process
    console.error('React Error:', error, info.componentStack);
    // TODO: Send to main process for logging
    // window.electronAPI.reportError({ message: error.message, stack: error.stack });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// === App Component ===
// TODO: Replace with your app component
function App(): React.ReactElement {
  return (
    <div className="app">
      <h1>My Electron App</h1>
      {/* TODO: Add your components and routes */}
    </div>
  );
}

// === Mount ===
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div>Loading...</div>}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
```

## Customization Notes

- **Error boundary fallback**: Replace the inline fallback UI with a styled component that matches your application's design. Consider adding a "Report Issue" button that sends error details to the main process via `window.electronAPI`.
- **Error reporting**: Uncomment and implement the `window.electronAPI.reportError` call in `componentDidCatch` to forward renderer errors to the main process for logging or crash reporting.
- **Routing**: Add `react-router-dom` with a `HashRouter` (preferred for Electron over `BrowserRouter` since there is no server to handle URL paths). Wrap the `App` component or its contents with your router provider.
- **State management**: If your app needs global state, wrap the `App` component with your provider (e.g., Redux `Provider`, Zustand context, or React context). Place it inside the `ErrorBoundary` but outside `Suspense`.
- **Lazy loading**: Use `React.lazy()` for route-level code splitting. The `Suspense` wrapper is already in place to show a fallback while lazy components load. Customize the fallback to match your loading UI.
- **CSS**: The template imports `index.css` for global styles. Add CSS modules or a CSS-in-JS solution for component-level styling as needed.
- **StrictMode**: `React.StrictMode` is enabled to help catch side effects and deprecated API usage during development. It causes components to render twice in development mode, which is expected behavior.
- **Mount element**: The template expects a `<div id="root">` element in your `index.html`. Ensure your HTML template includes this element.

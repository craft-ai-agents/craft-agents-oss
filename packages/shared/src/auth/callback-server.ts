import { createServer as createHttpServer, type Server } from 'http';
import { URL } from 'url';
import { generateCallbackPage, type AppType } from './callback-page.ts';

// Re-export for backwards compatibility
export { generateCallbackPage, type AppType } from './callback-page.ts';

const START_PORT = 6477;
const MAX_PORT_ATTEMPTS = 100;

export interface CallbackPayload {
  // For now just the query params. In the future we may extend this with other request properties.
  query: Record<string, string>;
}

export interface CallbackServer {
  promise: Promise<CallbackPayload>;
  url: string;
  /** Close the callback server. Call this on component unmount to clean up. */
  close: () => void | Promise<void>;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createHttpServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(): Promise<number> {
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = START_PORT + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${START_PORT}-${START_PORT + MAX_PORT_ATTEMPTS - 1}`);
}

export interface CreateCallbackServerOptions {
  appType?: AppType;
  /** Deep link URL to redirect to after successful auth (e.g., vesper://auth-complete) */
  deeplinkUrl?: string;
}

export async function createCallbackServer(options?: CreateCallbackServerOptions): Promise<CallbackServer> {
  const appType = options?.appType ?? 'terminal';
  const deeplinkUrl = options?.deeplinkUrl;
  const port = await findAvailablePort();

  let server: Server | null = null;
  let resolveCallback: ((payload: CallbackPayload) => void) | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;

  const callbackPromise = new Promise<CallbackPayload>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const requestHandler = async (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const query: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });

      const payload: CallbackPayload = {
        query,
      };

      // Check if this looks like a successful auth callback
      const hasCode = !!query.code;
      const hasError = !!query.error;

      // Send a styled success/error page
      const html = generateCallbackPage({
        title: hasError ? 'Authorization Failed' : 'Authorization Complete',
        isSuccess: hasCode && !hasError,
        errorDetail: query.error_description || query.error,
        appType,
        deeplinkUrl: (hasCode && !hasError) ? deeplinkUrl : undefined,
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);

      if (server) {
        server.close();
        server = null;
      }

      if (resolveCallback) {
        resolveCallback(payload);
      }
    } catch (error) {
      const html = generateCallbackPage({
        title: 'Error',
        isSuccess: false,
        errorDetail: error instanceof Error ? error.message : 'Internal Server Error',
        appType,
      });

      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);

      if (rejectCallback) {
        rejectCallback(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (server) {
        server.close();
        server = null;
      }
    }
  };

  // Create HTTP server
  server = createHttpServer(requestHandler);

  await new Promise<void>((resolve, reject) => {
    server?.once('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
      rejectCallback?.(error instanceof Error ? error : new Error(String(error)));
    });
    server?.listen(port, 'localhost', () => {
      resolve();
    });
  });

  const callbackUrl = `http://localhost:${port}`;

  return {
    promise: callbackPromise,
    url: callbackUrl,
    close: () => {
      if (server) {
        server.close();
        server = null;
      }
    },
  };
}

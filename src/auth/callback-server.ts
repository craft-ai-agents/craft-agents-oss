import { createServer, type Server, type IncomingMessage } from 'http';
import { URL } from 'url';

const START_PORT = 6477;
const MAX_PORT_ATTEMPTS = 100;

export interface CallbackPayload {
  // For now just the query params. In the future we may extend this with other request properties.
  query: Record<string, string>;
}

export interface CallbackServer {
  promise: Promise<CallbackPayload>;
  url: string;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
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

export async function createCallbackServer(): Promise<CallbackServer> {
  const port = await findAvailablePort();
  
  let server: Server | null = null;
  let resolveCallback: ((payload: CallbackPayload) => void) | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;

  const callbackPromise = new Promise<CallbackPayload>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      
      const query: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });

      const payload: CallbackPayload = {
        query,
      };

      // Send a simple success response
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');

      if (server) {
        server.close();
        server = null;
      }
      
      if (resolveCallback) {
        resolveCallback(payload);
      }
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
      
      if (rejectCallback) {
        rejectCallback(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (server) {
        server.close();
        server = null;
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server?.on('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
      rejectCallback?.(error instanceof Error ? error : new Error(String(error)));
    });
    server?.listen(port, 'localhost', () => {
      resolve();
    });
  });
  return {
    promise: callbackPromise,
    url: `http://localhost:${port}`,
  };
}

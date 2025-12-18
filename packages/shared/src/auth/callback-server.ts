import { debug } from '../utils/debug';
import { createServer, type Server } from 'http';
import { URL } from 'url';
import { CRAFT_LOGO_HTML } from '../branding.ts';

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

/**
 * Generate a styled callback page with terminal emulator aesthetic
 * Matches the OAuth page design with Tokyo Night theme
 */
function generateCallbackPage(options: {
  title: string;
  isSuccess: boolean;
  errorDetail?: string;
}): string {
  const { title, isSuccess, errorDetail } = options;

  // Terminal output lines based on success/error
  interface TerminalLine {
    text: string;
    status?: string;
    statusClass?: string;
    isHighlight?: boolean;
    highlightColor?: 'green' | 'red';
    hasCursor?: boolean;
    isError?: boolean;
  }

  const terminalLines: TerminalLine[] = isSuccess
    ? [
        { text: 'initiating craft connection...' },
        { text: 'verifying authorization', status: '[PROCESSING]', statusClass: 'status-wait' },
        { text: 'token received', status: '[OK]', statusClass: 'status-ok' },
        { text: 'AUTHORIZATION SUCCESSFUL', isHighlight: true, highlightColor: 'green' },
        { text: 'returning to terminal', hasCursor: true },
      ]
    : [
        { text: 'initiating craft connection...' },
        { text: 'verifying authorization', status: '[PROCESSING]', statusClass: 'status-wait' },
        { text: 'authorization failed', status: '[ERROR]', statusClass: 'status-error' },
        { text: 'AUTHORIZATION FAILED', isHighlight: true, highlightColor: 'red' },
        ...(errorDetail ? [{ text: `error: ${errorDetail}`, isError: true }] : []),
      ];

  const terminalLinesHtml = terminalLines.map((line, i) => {
    let content = '';
    if (line.isHighlight) {
      const color = line.highlightColor === 'green' ? 'var(--green)' : 'var(--red)';
      const glow = line.highlightColor === 'green'
        ? 'rgba(158, 206, 106, 0.4)'
        : 'rgba(247, 118, 142, 0.4)';
      content = `<span class="cmd-text" style="color: ${color}; text-shadow: 0 0 10px ${glow};">${line.text}</span>`;
    } else if (line.isError) {
      content = `<span class="cmd-text" style="color: var(--red);">${line.text}</span>`;
    } else {
      content = `<span class="cmd-text">${line.text}${line.status ? ` <span class="${line.statusClass}">${line.status}</span>` : ''}${line.hasCursor ? ' <span class="cursor"></span>' : ''}</span>`;
    }
    return `        <div class="line" style="animation-delay: ${0.2 + i * 0.4}s;">
          <span class="prompt">➜</span>
          <span class="path">~</span>
          ${content}
        </div>`;
  }).join('\n');

  const logoColor = isSuccess ? 'var(--blue)' : 'var(--red)';
  const logoGlow = isSuccess
    ? 'rgba(122, 162, 247, 0.3)'
    : 'rgba(247, 118, 142, 0.3)';

  // Auto-close countdown for success
  const progressSection = isSuccess ? `
      <div class="progress-section">
        <div id="countdown-container">
          <div class="timer-info">
            <span>Auto-closing</span>
            <span id="countdown-text">3.0s</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" id="progress-fill"></div>
          </div>
        </div>
        <div id="redirect-notice" style="display: none;">
          <span style="color: var(--comment); font-size: 12px;">
            If you haven't been redirected automatically, you can safely close this window and return to the terminal.
          </span>
        </div>
      </div>` : '';

  const autoCloseScript = isSuccess ? `
    // Countdown Logic
    setTimeout(() => {
      const duration = 3000;
      const start = Date.now();
      const progressFill = document.getElementById('progress-fill');
      const countdownText = document.getElementById('countdown-text');

      const tick = () => {
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, duration - elapsed);
        const percent = Math.min(100, (elapsed / duration) * 100);

        if(progressFill) progressFill.style.width = percent + '%';
        if(countdownText) countdownText.textContent = (remaining / 1000).toFixed(1) + 's';

        if (elapsed < duration) {
          requestAnimationFrame(tick);
        } else {
          // Try to close the window
          window.close();
          // If window.close() didn't work (browser blocked it), show fallback message
          setTimeout(() => {
            const countdownContainer = document.getElementById('countdown-container');
            const redirectNotice = document.getElementById('redirect-notice');
            if (countdownContainer) countdownContainer.style.display = 'none';
            if (redirectNotice) redirectNotice.style.display = 'block';
          }, 100);
        }
      };

      requestAnimationFrame(tick);
    }, 2200);` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Craft - ${title}</title>
  <style>
    :root {
      /* Tokyo Night Palette */
      --bg: #1a1b26;
      --bg-dark: #16161e;
      --bg-lighter: #24283b;
      --fg: #c0caf5;
      --comment: #565f89;
      --blue: #7aa2f7;
      --cyan: #7dcfff;
      --green: #9ece6a;
      --magenta: #bb9af7;
      --red: #f7768e;
      --yellow: #e0af68;
      --orange: #ff9e64;
      --terminal-black: #414868;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 0;
      width: 100vw;
      height: 100vh;
      background-color: var(--bg);
      color: var(--fg);
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }

    /* CRT Scanline Effect */
    body::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(
        to bottom,
        rgba(18, 16, 16, 0) 50%,
        rgba(0, 0, 0, 0.25) 50%
      );
      background-size: 100% 4px;
      z-index: 20;
      pointer-events: none;
      opacity: 0.15;
    }

    /* CRT Flicker */
    @keyframes flicker {
      0% { opacity: 0.98; }
      5% { opacity: 0.95; }
      10% { opacity: 0.98; }
      100% { opacity: 0.98; }
    }

    .terminal-window {
      width: 90%;
      max-width: 850px;
      height: 70vh;
      min-height: 500px;
      background: rgba(22, 22, 30, 0.95);
      border: 1px solid var(--terminal-black);
      box-shadow:
        0 0 40px rgba(0, 0, 0, 0.6),
        0 0 10px rgba(0, 0, 0, 0.4),
        0 0 0 1px rgba(122, 162, 247, 0.05);
      border-radius: 6px;
      position: relative;
      z-index: 10;
      display: flex;
      flex-direction: column;
      animation: bootUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      overflow: hidden;
      backdrop-filter: blur(4px);
    }

    .title-bar {
      background: var(--bg-lighter);
      border-bottom: 1px solid var(--terminal-black);
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }

    .title-text {
      color: var(--comment);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .window-controls {
      display: flex;
      gap: 8px;
    }

    .control {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      position: relative;
    }
    .control.close { background: var(--red); }
    .control.minimize { background: var(--yellow); }
    .control.maximize { background: var(--green); }

    .content {
      padding: 30px;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow-y: auto;
      animation: flicker 4s infinite;
    }

    .meta-info {
      width: 100%;
      text-align: left;
      font-size: 12px;
      color: var(--comment);
      margin-bottom: 30px;
      border-bottom: 1px dashed var(--terminal-black);
      padding-bottom: 15px;
      opacity: 0.8;
    }

    .logo-container {
      margin-bottom: 30px;
      width: 100%;
      display: flex;
      justify-content: center;
      overflow-x: auto;
      padding-bottom: 10px;
    }

    .logo {
      color: ${logoColor};
      font-weight: 700;
      font-size: 12px;
      line-height: 1;
      white-space: pre;
      text-align: left;
      text-shadow: 0 0 15px ${logoGlow};
      letter-spacing: normal;
    }

    .terminal-output {
      width: 100%;
      max-width: 600px;
      text-align: left;
      font-size: 14px;
      line-height: 1.8;
    }

    .line {
      display: flex;
      gap: 12px;
      margin-bottom: 6px;
      opacity: 0;
      animation: typeLine 0.1s forwards;
    }

    .prompt { color: var(--magenta); font-weight: bold; }
    .path { color: var(--blue); }
    .cmd-text { color: var(--fg); text-shadow: 0 0 2px rgba(192, 202, 245, 0.2); }

    .status-ok { color: var(--green); font-weight: bold; }
    .status-wait { color: var(--yellow); }
    .status-error { color: var(--red); font-weight: bold; }
    .highlight { color: var(--cyan); }

    .cursor {
      display: inline-block;
      width: 8px;
      height: 1.2em;
      background: var(--fg);
      vertical-align: sub;
      margin-left: 8px;
      opacity: 0;
    }

    .line:last-child .cursor {
      animation: blink 1s step-end infinite, appear 0.1s forwards 2.2s;
    }

    .progress-section {
      margin-top: 40px;
      width: 100%;
      max-width: 450px;
      opacity: 0;
      animation: fadeIn 0.5s forwards 2.0s;
    }

    .progress-bar {
      height: 2px;
      background: var(--bg-lighter);
      margin-top: 10px;
      position: relative;
    }

    .progress-fill {
      height: 100%;
      width: 0%;
      background: var(--green);
      box-shadow: 0 0 15px var(--green);
    }

    .timer-info {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--comment);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    /* Mobile Responsive Styles */
    @media (max-width: 640px) {
      body {
        align-items: flex-start;
        padding-top: 0;
        background: var(--bg-dark);
      }

      .terminal-window {
        width: 100%;
        height: 100vh;
        max-width: none;
        border-radius: 0;
        border: none;
        box-shadow: none;
      }

      .title-bar {
        padding: 12px 15px;
      }

      .content {
        padding: 20px 15px;
        justify-content: flex-start;
      }

      .logo {
        font-size: 2.2vw;
        align-self: center;
      }

      @media (max-width: 400px) {
        .logo { font-size: 1.9vw; }
      }

      .terminal-output {
        font-size: 12px;
        margin-top: 20px;
      }

      .meta-info {
        margin-bottom: 20px;
        font-size: 10px;
      }
    }

    @keyframes bootUp {
      from { opacity: 0; transform: scale(0.98); }
      to { opacity: 1; transform: scale(1); }
    }

    @keyframes typeLine {
      from { opacity: 0; transform: translateX(-4px); }
      to { opacity: 1; transform: translateX(0); }
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    @keyframes appear { to { opacity: 1; } }
    @keyframes fadeIn { to { opacity: 1; } }

  </style>
</head>
<body>
  <div class="terminal-window">
    <div class="title-bar">
      <div class="window-controls">
        <div class="control close"></div>
        <div class="control minimize"></div>
        <div class="control maximize"></div>
      </div>
      <div class="title-text">
        user@craft-cli ~
      </div>
      <div style="width: 48px;"></div>
    </div>

    <div class="content">
      <div class="meta-info">
        Last login: <span id="login-time">...</span> on ttys003
      </div>

      <div class="logo-container">
<pre class="logo">${CRAFT_LOGO_HTML}</pre>
      </div>

      <div class="terminal-output">
${terminalLinesHtml}
      </div>
${progressSection}
    </div>
  </div>

  <script>
    // Set Login Time
    const now = new Date();
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const timeString = days[now.getDay()] + ' ' + months[now.getMonth()] + ' ' + now.getDate() + ' ' + now.toTimeString().split(' ')[0];
    document.getElementById('login-time').textContent = timeString;
${autoCloseScript}
  </script>
</body>
</html>`;
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

      debug('[callback-server] request pathname:', url.pathname);

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

#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Electron App Scaffolder
 *
 * Generates an electron-vite project structure with best-practice defaults.
 * Includes secure BrowserWindow configuration and typed IPC setup.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/scaffold-electron-app.ts --name <name> [options]
 *
 * Options:
 *   --name <name>   App name (required)
 *   --path <path>   Target directory (default: current directory)
 *   --with-react    Include React 18 setup (default: true)
 *   --with-trpc     Include electron-trpc setup
 *   --with-tests    Include Playwright test setup
 *   -h, --help      Show help
 */

// === Constants ===
const VERSION = "1.0.0";
const SCRIPT_NAME = "scaffold-electron-app";

// === Types ===
interface ScaffoldOptions {
  name: string;
  path: string;
  withReact: boolean;
  withTrpc: boolean;
  withTests: boolean;
}

interface GeneratedFile {
  path: string;
  content: string;
}

// === Templates ===
function getMainIndexTs(appName: string): string {
  return `import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { registerIpcHandlers } from './ipc-handlers';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    title: '${appName}',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
`;
}

function getMainIpcHandlersTs(): string {
  return `import { ipcMain } from 'electron';

export function registerIpcHandlers(): void {
  ipcMain.handle('app:get-version', () => {
    return process.versions.electron;
  });

  // Register additional IPC handlers here
}
`;
}

function getPreloadIndexTs(): string {
  return `import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from './index.d';

const api: ElectronAPI = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
`;
}

function getPreloadIndexDts(): string {
  return `export interface ElectronAPI {
  getVersion: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
`;
}

function getRendererIndexHtml(appName: string, withReact: boolean): string {
  const rootDiv = withReact
    ? '    <div id="root"></div>'
    : '    <div id="app"></div>';
  const scriptTag = withReact
    ? '    <script type="module" src="./src/main.tsx"></script>'
    : '    <script type="module" src="./src/main.ts"></script>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    />
    <title>${appName}</title>
  </head>
  <body>
${rootDiv}
${scriptTag}
  </body>
</html>
`;
}

function getRendererMainTsx(): string {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;
}

function getRendererAppTsx(appName: string): string {
  return `import { useState, useEffect } from 'react';

function App(): JSX.Element {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    window.electronAPI.getVersion().then(setVersion);
  }, []);

  return (
    <div>
      <h1>${appName}</h1>
      <p>Electron version: {version}</p>
    </div>
  );
}

export default App;
`;
}

function getSharedIpcTypes(): string {
  return `/**
 * Shared IPC type definitions.
 *
 * These types are used by both main and renderer processes
 * to ensure type-safe IPC communication.
 */

export type IpcChannelMap = {
  'app:get-version': {
    args: [];
    return: string;
  };
};

export type IpcChannel = keyof IpcChannelMap;
`;
}

function getElectronViteConfig(): string {
  return `import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
  },
});
`;
}

function getElectronViteConfigNoReact(): string {
  return `import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
  },
});
`;
}

function getPackageJson(
  appName: string,
  withReact: boolean,
  withTrpc: boolean,
  withTests: boolean
): string {
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {
    electron: "^33.0.0",
    "electron-vite": "^2.3.0",
    "@electron-toolkit/utils": "^3.0.0",
    typescript: "^5.6.0",
    vite: "^5.4.0",
  };
  const scripts: Record<string, string> = {
    dev: "electron-vite dev",
    build: "electron-vite build",
    start: "electron-vite preview",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json",
    typecheck: "npm run typecheck:node && npm run typecheck:web",
  };

  if (withReact) {
    deps["react"] = "^18.3.0";
    deps["react-dom"] = "^18.3.0";
    devDeps["@types/react"] = "^18.3.0";
    devDeps["@types/react-dom"] = "^18.3.0";
    devDeps["@vitejs/plugin-react"] = "^4.3.0";
  }

  if (withTrpc) {
    deps["@trpc/server"] = "^10.45.0";
    deps["@trpc/client"] = "^10.45.0";
    deps["electron-trpc"] = "^0.6.0";
    deps["zod"] = "^3.23.0";
  }

  if (withTests) {
    devDeps["@playwright/test"] = "^1.48.0";
    scripts["test:e2e"] = "playwright test";
  }

  const pkg = {
    name: appName,
    version: "0.1.0",
    private: true,
    main: "./out/main/index.js",
    scripts,
    dependencies: deps,
    devDependencies: devDeps,
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}

function getTsconfigJson(): string {
  return `{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
`;
}

function getTsconfigNodeJson(): string {
  return `{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./out"
  },
  "include": [
    "src/main/**/*.ts",
    "src/preload/**/*.ts",
    "src/preload/**/*.d.ts",
    "src/shared/**/*.ts",
    "electron.vite.config.ts"
  ]
}
`;
}

function getTsconfigWebJson(): string {
  return `{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@renderer/*": ["src/renderer/src/*"]
    }
  },
  "include": [
    "src/renderer/src/**/*.ts",
    "src/renderer/src/**/*.tsx",
    "src/preload/**/*.d.ts"
  ]
}
`;
}

function getTrpcRouterTs(): string {
  return `import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create({ isServer: true });

export const router = t.router({
  greeting: t.procedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => {
      return { text: \`Hello, \${input.name}!\` };
    }),
});

export type AppRouter = typeof router;
`;
}

function getTrpcClientTs(): string {
  return `import { createTRPCProxyClient } from '@trpc/client';
import { ipcLink } from 'electron-trpc/renderer';
import type { AppRouter } from '../../main/router';

export const trpcClient = createTRPCProxyClient<AppRouter>({
  links: [ipcLink()],
});
`;
}

function getPlaywrightConfigTs(): string {
  return `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    trace: 'on-first-retry',
  },
});
`;
}

function getE2eTestTs(appName: string): string {
  return `import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';

test('app launches and shows window', async () => {
  const electronApp = await electron.launch({
    args: ['.'],
  });

  const window = await electronApp.firstWindow();
  const title = await window.title();
  expect(title).toBe('${appName}');

  await electronApp.close();
});
`;
}

// === File Generation ===
function generateFiles(options: ScaffoldOptions): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const base = options.path;

  // Main process
  files.push({
    path: `${base}/src/main/index.ts`,
    content: getMainIndexTs(options.name),
  });
  files.push({
    path: `${base}/src/main/ipc-handlers.ts`,
    content: getMainIpcHandlersTs(),
  });

  // Preload
  files.push({
    path: `${base}/src/preload/index.ts`,
    content: getPreloadIndexTs(),
  });
  files.push({
    path: `${base}/src/preload/index.d.ts`,
    content: getPreloadIndexDts(),
  });

  // Renderer
  files.push({
    path: `${base}/src/renderer/index.html`,
    content: getRendererIndexHtml(options.name, options.withReact),
  });

  if (options.withReact) {
    files.push({
      path: `${base}/src/renderer/src/main.tsx`,
      content: getRendererMainTsx(),
    });
    files.push({
      path: `${base}/src/renderer/src/App.tsx`,
      content: getRendererAppTsx(options.name),
    });
  }

  // Shared
  files.push({
    path: `${base}/src/shared/ipc-types.ts`,
    content: getSharedIpcTypes(),
  });

  // Config files
  files.push({
    path: `${base}/electron.vite.config.ts`,
    content: options.withReact
      ? getElectronViteConfig()
      : getElectronViteConfigNoReact(),
  });
  files.push({
    path: `${base}/package.json`,
    content: getPackageJson(
      options.name,
      options.withReact,
      options.withTrpc,
      options.withTests
    ),
  });
  files.push({
    path: `${base}/tsconfig.json`,
    content: getTsconfigJson(),
  });
  files.push({
    path: `${base}/tsconfig.node.json`,
    content: getTsconfigNodeJson(),
  });
  files.push({
    path: `${base}/tsconfig.web.json`,
    content: getTsconfigWebJson(),
  });

  // tRPC (optional)
  if (options.withTrpc) {
    files.push({
      path: `${base}/src/main/router.ts`,
      content: getTrpcRouterTs(),
    });
    files.push({
      path: `${base}/src/renderer/src/trpc-client.ts`,
      content: getTrpcClientTs(),
    });
  }

  // Tests (optional)
  if (options.withTests) {
    files.push({
      path: `${base}/playwright.config.ts`,
      content: getPlaywrightConfigTs(),
    });
    files.push({
      path: `${base}/tests/e2e/app.spec.ts`,
      content: getE2eTestTs(options.name),
    });
  }

  return files;
}

// === Directory Creation ===
async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

async function writeFiles(files: GeneratedFile[]): Promise<void> {
  for (const file of files) {
    const dir = file.path.substring(0, file.path.lastIndexOf("/"));
    await ensureDir(dir);
    await Deno.writeTextFile(file.path, file.content);
  }
}

// === Scaffold ===
async function scaffold(options: ScaffoldOptions): Promise<GeneratedFile[]> {
  // Create resource directories (even if empty)
  const base = options.path;
  await ensureDir(`${base}/resources`);

  const files = generateFiles(options);
  await writeFiles(files);

  return files;
}

// === Output Formatting ===
function formatHumanOutput(
  options: ScaffoldOptions,
  files: GeneratedFile[]
): void {
  console.log("\nELECTRON APP SCAFFOLDED");
  console.log("=======================\n");
  console.log(`App name: ${options.name}`);
  console.log(`Location: ${options.path}`);
  console.log(`React:    ${options.withReact ? "yes" : "no"}`);
  console.log(`tRPC:     ${options.withTrpc ? "yes" : "no"}`);
  console.log(`Tests:    ${options.withTests ? "yes" : "no"}`);
  console.log();

  console.log("FILES CREATED:");
  console.log();
  for (const file of files) {
    const relativePath = file.path.replace(options.path + "/", "");
    console.log(`  ${relativePath}`);
  }
  console.log();

  console.log("NEXT STEPS:");
  console.log(`  cd ${options.path}`);
  console.log("  npm install");
  console.log("  npm run dev");
  console.log();
}

// === Help Text ===
function printHelp(): void {
  console.log(`
${SCRIPT_NAME} v${VERSION} - Electron App Scaffolder

Usage:
  deno run --allow-read --allow-write scripts/scaffold-electron-app.ts --name <name> [options]

Options:
  --name <name>   App name (required)
  --path <path>   Target directory (default: current directory)
  --with-react    Include React 18 setup (default: true)
  --with-trpc     Include electron-trpc setup
  --with-tests    Include Playwright test setup
  -h, --help      Show this help

Examples:
  # Scaffold a new app with defaults (React included)
  deno run --allow-read --allow-write scripts/scaffold-electron-app.ts --name my-app

  # Scaffold in a specific directory
  deno run --allow-read --allow-write scripts/scaffold-electron-app.ts --name my-app --path ./projects/my-app

  # Include tRPC and Playwright tests
  deno run --allow-read --allow-write scripts/scaffold-electron-app.ts --name my-app --with-trpc --with-tests

Generated Structure:
  src/
    main/
      index.ts             Main process entry with secure BrowserWindow
      ipc-handlers.ts      IPC handler registration
    preload/
      index.ts             contextBridge preload script
      index.d.ts           Type declarations for preload API
    renderer/
      index.html           HTML entry with Content-Security-Policy
      src/
        main.tsx           React 18 createRoot entry (if --with-react)
        App.tsx            Basic App component (if --with-react)
    shared/
      ipc-types.ts         Shared IPC type definitions
  resources/               App resources (icons, etc.)
  electron.vite.config.ts  Unified electron-vite configuration
  package.json             Dependencies and scripts
  tsconfig.json            Root TypeScript config
  tsconfig.node.json       Node (main/preload) TypeScript config
  tsconfig.web.json        Web (renderer) TypeScript config

Optional (with --with-trpc):
  src/main/router.ts                 tRPC router definition
  src/renderer/src/trpc-client.ts    tRPC client setup

Optional (with --with-tests):
  playwright.config.ts               Playwright configuration
  tests/e2e/app.spec.ts              Basic E2E test
`);
}

// === CLI Handler ===
function parseArgs(args: string[]): ScaffoldOptions | null {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return null;
  }

  const options: ScaffoldOptions = {
    name: "",
    path: ".",
    withReact: true,
    withTrpc: false,
    withTests: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--name" && i + 1 < args.length) {
      options.name = args[++i];
    } else if (arg === "--path" && i + 1 < args.length) {
      options.path = args[++i];
    } else if (arg === "--with-react") {
      options.withReact = true;
    } else if (arg === "--with-trpc") {
      options.withTrpc = true;
    } else if (arg === "--with-tests") {
      options.withTests = true;
    }
  }

  if (!options.name) {
    console.error("Error: --name is required");
    return null;
  }

  return options;
}

// === Entry Point ===
async function main(): Promise<void> {
  const options = parseArgs(Deno.args);

  if (!options) {
    printHelp();
    Deno.exit(0);
  }

  const files = await scaffold(options);

  const jsonFlag = Deno.args.includes("--json");
  if (jsonFlag) {
    const result = {
      name: options.name,
      path: options.path,
      withReact: options.withReact,
      withTrpc: options.withTrpc,
      withTests: options.withTests,
      filesCreated: files.map((f) => f.path),
    };
    console.log(JSON.stringify(result, null, 2));
  } else {
    formatHumanOutput(options, files);
  }
}

if (import.meta.main) {
  main();
}

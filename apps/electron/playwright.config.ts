import { defineConfig, devices } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const configDir = dirname(fileURLToPath(import.meta.url))
const harnessUrl = pathToFileURL(resolve(configDir, 'playwright', 'affordances') + '/').href

export default defineConfig({
  testDir: './playwright/tests',
  testMatch: '**/*.pw.ts',
  outputDir: './playwright/test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  expect: {
    maxDiffPixelRatio: 0.001,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'device',
    },
  },
  use: {
    headless: true,
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    baseURL: harnessUrl,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})

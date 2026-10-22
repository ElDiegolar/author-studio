import { defineConfig } from '@playwright/test';

/**
 * End-to-end flow over every feature. `npm run e2e` uses the fake model (deterministic, free);
 * `npm run e2e:live` uses the real provider from ~/.config/author-studio/env.
 * One worker, files in order: later rooms build on what earlier ones created (like an author would).
 */
const live = process.env.E2E_LIVE === '1';
const port = Number(process.env.E2E_PORT ?? 8798);

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: live ? 240_000 : 30_000,
  expect: { timeout: live ? 120_000 : 8_000 },
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'node e2e/serve.mjs', cwd: '..', url: `http://127.0.0.1:${port}/api/bible`, timeout: 60_000, reuseExistingServer: false, stdout: 'ignore', stderr: 'pipe' },
});

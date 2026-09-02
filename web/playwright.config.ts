import { defineConfig } from '@playwright/test';

const baseURL = 'http://localhost:3000';
const vinextCommand = `"${process.execPath}" node_modules/vinext/dist/cli.js dev`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: vinextCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

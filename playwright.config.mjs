import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

const dataDir = mkdtempSync(join(tmpdir(), 'lodge-e2e-'))
const port = 8791

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  // 两个 spec 会改同一间示例房，串行跑，避免互相归档/恢复造成假失败。
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      CREW_PORT: String(port),
      CREW_DATA_DIR: dataDir,
      // E2E 不接本机基座，避免界面状态随开发机安装的 CLI 变化。
      CREW_BASE_URL: 'http://127.0.0.1:8798',
      // 邮箱设置写临时目录，不碰开发机自己的 ~/.lodge/smtp.json。
      LODGE_SMTP_CONFIG: join(dataDir, 'smtp.json'),
    },
  },
})

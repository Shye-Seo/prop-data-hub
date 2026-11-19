import { defineConfig, devices } from '@playwright/test';

/**
 * 프로덕션 빌드(docs/)를 정적 서버로 서빙해 실제 배포 산출물을 검증한다.
 * vite preview가 아니라 의존성 없는 서버를 쓰므로 GitHub Pages와 같은 조건(상대 경로·정적 파일)이 된다.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-static.mjs docs 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 테스트 러너가 여는 내부 서버는 루프백 주소로 고정한다(호스트명 해석이 막힌 환경 대응).
  server: { host: '127.0.0.1' },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

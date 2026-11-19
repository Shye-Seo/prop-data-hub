import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 테스트 러너가 여는 내부 서버는 루프백 주소로 고정한다.
  // 호스트명 해석이 제한된 환경(사내망·CI 컨테이너)에서도 동일하게 동작한다.
  server: { host: '127.0.0.1' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

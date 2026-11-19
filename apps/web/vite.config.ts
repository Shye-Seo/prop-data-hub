import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 하위 경로(/prop-data-hub/)에서도 자산 경로가 깨지지 않도록 상대 경로로 빌드한다.
  base: './',
  build: {
    outDir: '../../docs',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});

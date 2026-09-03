import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    // HTML export consumes real CSS text, including KaTeX font-face declarations.
    css: { include: [/\.css(?:\?|$)/] },
    setupFiles: ['./src/test/setup.ts'],
    include: ['./src/**/*.test.{ts,tsx}', './components/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});

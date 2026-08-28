import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['src/**/*.browser.test.ts'],
    expect: { poll: { timeout: 2_000 } },
    browser: { enabled: true, provider: playwright(), instances: [{ browser: 'chromium' }] }
  }
});

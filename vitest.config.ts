import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  test: {
    include: ['src/**/*.browser.test.ts'],
    setupFiles: ['./test/browser-setup.ts'],
    expect: { poll: { timeout: 2_000 } },
    browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] }
  }
});

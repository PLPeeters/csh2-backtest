import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '.agent/execplans/artifacts/', 'src/**/*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  { files: ['src/**/*.{ts,svelte}'], languageOptions: { globals: { ...globals.browser, ...globals.worker } }, rules: { 'no-undef': 'off', '@typescript-eslint/no-explicit-any': 'off' } },
  { files: ['**/*.svelte'], languageOptions: { parserOptions: { parser: tseslint.parser } }, rules: { 'svelte/require-each-key': 'off' } },
  { files: ['**/*.svelte.ts'], languageOptions: { parser: tseslint.parser } }
);

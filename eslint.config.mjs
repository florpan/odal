// ESLint enforces the architecture boundaries described in docs/ARCHITECTURE.md.
// If you hit one of the "restricted import" errors, the fix is almost never to
// disable the rule: it is to move the code to the layer it belongs to.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const restrict = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },

  // --- engine: pure rules. No I/O, no framework, no content, no server/client. ---
  {
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/**/*.test.ts'],
    rules: restrict([
      {
        group: ['@odal/content', '@odal/server', '@odal/client'],
        message: 'The engine depends on nothing but itself (and zod).',
      },
      {
        group: ['node:*', 'bun', 'bun:*', 'fs', 'path'],
        message: 'The engine must run unchanged in the browser: no Node/Bun APIs.',
      },
      { group: ['three', 'react', 'react-dom'], message: 'No rendering or UI in the engine.' },
    ]),
  },

  // --- content: data plus a loader. Never game logic. ---
  {
    files: ['packages/content/src/**/*.ts'],
    rules: restrict([
      {
        group: ['@odal/server', '@odal/client', 'three', 'react'],
        message: 'Content only depends on the engine.',
      },
    ]),
  },

  // --- server: talks to engine and content, never to the client package. ---
  {
    files: ['packages/server/src/**/*.ts'],
    rules: restrict([
      { group: ['@odal/client', 'three', 'react', 'react-dom'], message: 'The server never imports client code.' },
    ]),
  },

  // --- client/game: pure TypeScript. No React, no React-flavoured zustand. ---
  {
    files: ['packages/client/src/game/**/*.ts'],
    rules: restrict([
      {
        group: ['react', 'react-dom', 'react/*', 'react-dom/*', 'zustand'],
        message: 'game/ is framework-free. Use zustand/vanilla via app/store to talk to the UI.',
      },
      {
        group: ['@odal/content', '@odal/server'],
        message: 'The client receives content from the server; it never imports it.',
      },
      { group: ['**/ui/**'], message: 'game/ never imports UI components.' },
    ]),
  },

  // --- client/editor: the content editor page. React + engine + ui/tree; never the game. ---
  {
    files: ['packages/client/src/editor/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...restrict([
        { group: ['three'], message: 'The editor has no 3D view.' },
        {
          group: ['**/game/**', '**/app/**'],
          message: 'The editor is a separate page; it never touches the game session.',
        },
        {
          group: ['@odal/content', '@odal/server'],
          message: 'The editor reads content from the dev server, never imports it.',
        },
      ]),
    },
  },

  // --- client/ui: React only. Talks to the game through the store and the session API. ---
  {
    files: ['packages/client/src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...restrict([
        { group: ['three'], message: 'UI never touches Three.js. World visuals belong in game/render.' },
        {
          group: [
            '**/game/render/**',
            '**/game/input',
            '**/game/world',
            '**/game/net',
            '**/game/session',
            '**/game/minimap',
            '**/game/viewmodel',
          ],
          message: 'UI imports only from game/index.ts (the session API and view-model types).',
        },
        { group: ['@odal/content', '@odal/server'], message: 'UI gets everything it needs from the store.' },
      ]),
    },
  },
);

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/** Reguła pilnująca warstw monorepo (twardy niezmiennik z CLAUDE.md). */
function forbidLayerImports(forbidden, message) {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: forbidden.flatMap((layer) => [
          `@air-combat/${layer}`,
          `@air-combat/${layer}/*`,
          `**/packages/${layer}/**`,
        ]).map((pattern) => ({ group: [pattern], message })),
      },
    ],
  };
}

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-throw-literal': 'error',
    },
  },
  {
    files: ['packages/shared/**/*.ts'],
    rules: forbidLayerImports(['client', 'server'], 'shared nie importuje z client ani server'),
  },
  {
    files: ['packages/client/**/*.ts'],
    rules: forbidLayerImports(['server'], 'client nie importuje z server'),
  },
  {
    files: ['packages/server/**/*.ts'],
    rules: forbidLayerImports(['client'], 'server nie importuje z client'),
  },
  prettier,
);

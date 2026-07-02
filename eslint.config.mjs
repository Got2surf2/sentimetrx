// Flat config (ESLint 9). Replaces .eslintrc.json — Next 16 removed `next lint`,
// so we run eslint directly (`npm run lint`). eslint-config-next 16 ships a
// native flat config; we layer the same rules the old .eslintrc carried, at
// `warn`, over a large existing violation backlog (the value is the CI ratchet,
// not day-one enforcement — see docs/ENGINEERING.md §1).

import next from 'eslint-config-next/core-web-vitals'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      '.next/**', 'node_modules/**', 'coverage/**', 'out/**', 'dist/**',
      'sql/**', 'public/**', '*.config.*', 'next-env.d.ts',
      'scripts/_*.ts', // one-off client/deck scratch scripts
    ],
  },
  ...next,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        // Type-aware linting (needed by no-floating-promises / no-misused-promises).
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'react/no-unescaped-entities': 'off',
      // Burned to 0 on 2026-07-02 → promoted to error (ratchet doctrine).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      // Burned to 0 on 2026-07-02 → promoted to error (ratchet doctrine).
      '@typescript-eslint/consistent-type-imports': 'error',
      // eslint-plugin-react-hooks v6 (bundled with next 16) added these as
      // ERRORS. Over the existing god-components they'd hard-fail CI on day one;
      // demote to warn so they ride the same ratchet as everything else, then
      // burn them down (the god-component effect webs are the real target).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintPluginAstro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', '.astro/', 'node_modules/', '.cache/']),
  js.configs.recommended,

  // Las reglas que necesitan tipos solo en los .ts: `astro-eslint-parser` no
  // resuelve los módulos virtuales de Astro («astro:content») y todo lo que
  // sale de ellos llegaría como `any`. De los .astro se encarga `astro check`.
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      'pipeline/**/*.ts',
      'scripts/**/*.ts',
      'panel/**/*.ts',
      'ciudades/**/*.ts',
      'tests/**/*.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Regla 8: el motor no sabe de ciudades. `pipeline/` nunca importa de
  // `ciudades/`; quien las une es `scripts/` o `src/`, y siempre por el
  // registro `ciudades/index.ts`.
  {
    files: ['pipeline/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/ciudades', '**/ciudades/**'],
              message:
                'El motor no puede importar de ciudades/ (regla 8 de CLAUDE.md). La ciudad llega por parámetro.',
            },
          ],
        },
      ],
      // `no-restricted-imports` solo mira los imports estáticos: un `import()`
      // dinámico se colaría sin una queja.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/(^|\\/)ciudades(\\/|$)/]',
          message:
            'El motor no puede importar de ciudades/ (regla 8 de CLAUDE.md), tampoco con import() dinámico.',
        },
      ],
    },
  },

  eslintPluginAstro.configs.recommended,
  prettier,
);

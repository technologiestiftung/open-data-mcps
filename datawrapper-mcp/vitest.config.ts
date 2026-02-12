// ABOUTME: Vitest configuration for datawrapper-mcp tests
// ABOUTME: Configures TypeScript support and test file patterns

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/tests/**/*.test.ts'],
  },
});

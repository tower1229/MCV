import { defineConfig } from 'vitest/config';

const inCi = process.env.CI === 'true';

export default defineConfig({
  test: {
    fileParallelism: !inCi,
    ...(inCi ? { maxWorkers: 1 } : {}),
  },
});

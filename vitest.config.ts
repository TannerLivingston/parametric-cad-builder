import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 180000,
    // Set-up builds whole enclosures, as tests do, and slows as much when they all run at once.
    hookTimeout: 180000,
    // Each test file builds in an engine of its own, and too many at once slow every build past
    // the minute many tests allow themselves.
    maxWorkers: 8,
  },
});

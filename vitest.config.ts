import { defineConfig } from 'vitest/config';

// Three suites, matching the two tiers of the quality bar (docs/prd.md §7):
//
//   tier1      — fake engine, runs everywhere, fast.
//   tier2-wasm — real engine, engine-agnostic invariants, runs in CI (no Docker).
//   tier2-container — real engine over HTTP, container-path invariants. Runs locally;
//                     skips with a clear message when the engine is unreachable.
//
// The split is by file suffix so a test's tier is visible in its filename.
export default defineConfig({
  test: {
    globals: false,
    projects: [
      {
        test: {
          name: 'tier1',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.wasm.test.ts', 'tests/**/*.container.test.ts'],
        },
      },
      {
        test: {
          name: 'tier2-wasm',
          include: ['tests/**/*.wasm.test.ts'],
          // Genuine searches, not mocks — measured at 1.29s for three depth-12 searches,
          // but a cold WASM instantiation on a loaded CI runner is slower.
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'tier2-container',
          include: ['tests/**/*.container.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});

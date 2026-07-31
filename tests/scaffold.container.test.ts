import { describe, expect, it } from 'vitest';
import { ENGINE_URL, engineUnreachable } from './helpers/engine-availability.js';

// Skipped, not failed, when the container is not up — see the helper.
describe.skipIf(await engineUnreachable())('tier 2, container path', () => {
  it('reaches the engine health endpoint', async () => {
    const response = await fetch(`${ENGINE_URL}/health`);
    expect(response.ok).toBe(true);
  });
});

/**
 * Container reachability probe for tier-2 container tests.
 *
 * Container-path tests are skipped, not failed, when the engine is unreachable — a
 * developer without `docker compose up -d engine` running should still get a green
 * `npm test`, with a message saying what was skipped and how to enable it.
 */

export const ENGINE_URL = process.env['ENGINE_URL'] ?? 'http://localhost:8090';

const PROBE_TIMEOUT_MS = 1_500;

export type EngineAvailability =
  | { readonly reachable: true }
  | { readonly reachable: false; readonly reason: string };

let probed: Promise<EngineAvailability> | undefined;

async function probe(): Promise<EngineAvailability> {
  const url = `${ENGINE_URL}/health`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { reachable: false, reason: `${url} responded ${response.status}` };
    }
    return { reachable: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { reachable: false, reason: `${url} unreachable (${detail})` };
  }
}

/** Cached across the suite so N container test files cost one probe, not N. */
export function engineAvailability(): Promise<EngineAvailability> {
  probed ??= probe();
  return probed;
}

/**
 * Resolves to `true` when the engine is unreachable, for `describe.skipIf(...)`.
 * Logs why, so a skipped suite is never silent about the reason.
 */
export async function engineUnreachable(): Promise<boolean> {
  const availability = await engineAvailability();
  if (availability.reachable) return false;
  console.warn(
    `[tier2-container] skipped: ${availability.reason}. ` +
      `Start it with \`docker compose up -d engine\`, or set ENGINE_URL.`,
  );
  return true;
}

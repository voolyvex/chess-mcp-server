import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const repoRoot = new URL('../', import.meta.url);

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(relativePath, repoRoot), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('tier 1 runs everywhere', () => {
  it('runs without an engine of any kind', () => {
    expect(1 + 1).toBe(2);
  });
});

describe('the lockfile is the source of truth', () => {
  it('commits a lockfile at version 3 or later, which `npm ci` requires', async () => {
    const lockfile = await readJson('package-lock.json');
    expect(Number(lockfile['lockfileVersion'])).toBeGreaterThanOrEqual(3);
  });

  it('pins every dev dependency exactly — a floating range is a pin with a hole in it', async () => {
    const manifest = await readJson('package.json');
    const devDependencies = (manifest['devDependencies'] ?? {}) as Record<string, string>;
    expect(Object.keys(devDependencies).length).toBeGreaterThan(0);
    for (const [name, range] of Object.entries(devDependencies)) {
      expect(range, `${name} must be pinned exactly, got "${range}"`).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
    }
  });

  it('never invokes `npm install` from a script', async () => {
    const manifest = await readJson('package.json');
    const scripts = (manifest['scripts'] ?? {}) as Record<string, string>;
    for (const [name, body] of Object.entries(scripts)) {
      expect(body, `script "${name}" must not run npm install`).not.toMatch(
        /npm\s+(install|i)\b/,
      );
    }
  });
});

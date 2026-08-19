/**
 * Sign-in, and the upgrade path from v1.
 *
 * The migration cases matter as much as the flow: anyone upgrading already has
 * a key in `~/.updatespage/config.json`, and silently signing them out would
 * be the worst possible first impression of the new version.
 */

import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { credentialsPath, type CredentialsFile } from '../src/kit/credentials.ts';
import { EXIT } from '../src/kit/errors.ts';
import { stripAnsi } from '../src/kit/theme.ts';
import { createTempHome, run } from './support/harness.ts';
import { startMockServer, type MockServer } from './support/mock-server.ts';

let server: MockServer;

before(async () => {
  server = await startMockServer();
});

after(async () => {
  await server.close();
});

// DISPLAY is set because `login` picks its flow from the environment: with no
// display it correctly assumes there is no browser and falls back to a device
// code. Tests that want the browser flow have to look like a machine with one.
const env = (): Record<string, string> => ({ UPDATESPAGE_BASE_URL: server.url, DISPLAY: ':0' });

const readStore = async (home: string): Promise<CredentialsFile> =>
  JSON.parse(await readFile(credentialsPath(home, 'updatespage'), 'utf8')) as CredentialsFile;

/** Write a v1 config file, as an upgrading user would already have. */
const writeLegacyConfig = async (home: string, apiKey: string): Promise<void> => {
  await mkdir(join(home, '.updatespage'), { recursive: true });
  await writeFile(join(home, '.updatespage', 'config.json'), JSON.stringify({ apiKey }, null, 2));
};

test('browser sign-in stores a token', async () => {
  const home = await createTempHome();
  try {
    const result = await run({
      argv: ['login'],
      processEnv: env(),
      homeDir: home.path,
      fetch: globalThis.fetch,
      openExternal: async (url) => {
        await globalThis.fetch(url);
      },
    });

    assert.equal(result.exitCode, EXIT.ok, result.output.plain);
    assert.match(result.output.plain, /Signed in as Ada Lovelace/);

    const store = await readStore(home.path);
    assert.equal(store.profiles['default']?.baseUrl, server.url);
    assert.equal((await stat(credentialsPath(home.path, 'updatespage'))).mode & 0o777, 0o600);
  } finally {
    await home.cleanup();
  }
});

test('a v1 config.json still authenticates, so upgrading does not sign you out', async () => {
  const home = await createTempHome();
  try {
    await writeLegacyConfig(home.path, 'tok_test');

    const result = await run({
      argv: ['list', '--json'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.equal(result.exitCode, EXIT.ok, result.output.plain);
    const parsed = JSON.parse(result.output.stdout) as { ok: boolean };
    assert.equal(parsed.ok, true);
  } finally {
    await home.cleanup();
  }
});

test('doctor names the legacy file as the source, so the state is not a mystery', async () => {
  const home = await createTempHome();
  try {
    await writeLegacyConfig(home.path, 'tok_test');

    const result = await run({
      argv: ['doctor'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.match(stripAnsi(result.output.plain), /config\.json \(v1\)/);
  } finally {
    await home.cleanup();
  }
});

test('a saved credential wins over the legacy file', async () => {
  const home = await createTempHome();
  try {
    // A stale v1 key must not shadow a fresh sign-in.
    await writeLegacyConfig(home.path, 'tok_stale_v1');
    await run({
      argv: ['login'],
      processEnv: env(),
      homeDir: home.path,
      fetch: globalThis.fetch,
      openExternal: async (url) => {
        await globalThis.fetch(url);
      },
    });

    const store = await readStore(home.path);
    assert.notEqual(store.profiles['default']?.token, 'tok_stale_v1');

    const who = await run({
      argv: ['whoami', '--json'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });
    assert.equal(who.exitCode, EXIT.ok, who.output.plain);
  } finally {
    await home.cleanup();
  }
});

test('the legacy file is only consulted for the default profile', async () => {
  const home = await createTempHome();
  try {
    // A v1 key predates profiles, so attributing it to a named one would be
    // inventing a fact about where it came from.
    await writeLegacyConfig(home.path, 'tok_test');

    const result = await run({
      argv: ['list', '--profile', 'staging'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.equal(result.exitCode, EXIT.auth);
  } finally {
    await home.cleanup();
  }
});

test('`config --api-key` still works, warns, and writes the new format', async () => {
  const home = await createTempHome();
  try {
    const result = await run({
      argv: ['config', '--api-key', 'tok_test'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.equal(result.exitCode, EXIT.ok, result.output.plain);
    // Kept working so upgrading does not break anyone's setup, but it should
    // say why `login` is better — the key is in the shell history now.
    assert.match(stripAnsi(result.output.plain), /deprecated/i);
    assert.match(stripAnsi(result.output.plain), /login/);

    const store = await readStore(home.path);
    assert.equal(store.profiles['default']?.token, 'tok_test');
  } finally {
    await home.cleanup();
  }
});

test('`config` is hidden from help but still reachable', async () => {
  const help = await run({ argv: ['--help'] });
  assert.doesNotMatch(help.output.stdout, /^\s+config\s/m);

  const own = await run({ argv: ['config', '--help'] });
  assert.equal(own.exitCode, EXIT.ok);
  assert.match(own.output.stdout, /--api-key/);
});

test('logout revokes server-side, so the token stops working', async () => {
  const home = await createTempHome();
  try {
    const shared = { processEnv: env(), homeDir: home.path, fetch: globalThis.fetch };
    await run({
      argv: ['login'],
      ...shared,
      openExternal: async (url: string) => {
        await globalThis.fetch(url);
      },
    });
    const token = (await readStore(home.path)).profiles['default']?.token ?? '';
    assert.ok(server.tokens.has(token));

    const result = await run({ argv: ['logout'], ...shared });
    assert.equal(result.exitCode, EXIT.ok, result.output.plain);
    // Deleting only the local copy would be a lie to someone who ran this
    // because they think the token leaked.
    assert.equal(server.tokens.has(token), false);
  } finally {
    await home.cleanup();
  }
});

test('not signed in fails with the auth code and names the fix', async () => {
  const home = await createTempHome();
  try {
    const result = await run({
      argv: ['list'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      fetch: () => Promise.reject(new Error('should not have called the API')),
    });

    assert.equal(result.exitCode, EXIT.auth);
    assert.match(stripAnsi(result.output.stderr), /updates login/);
  } finally {
    await home.cleanup();
  }
});

test('a token bound to one endpoint is not sent to another', async () => {
  const home = await createTempHome();
  try {
    await run({
      argv: ['login'],
      processEnv: env(),
      homeDir: home.path,
      fetch: globalThis.fetch,
      openExternal: async (url: string) => {
        await globalThis.fetch(url);
      },
    });

    const elsewhere = await run({
      argv: ['whoami', '--base-url', 'https://somewhere-else.example'],
      processEnv: env(),
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.equal(elsewhere.exitCode, EXIT.auth);
    assert.match(stripAnsi(elsewhere.output.plain), /will not be sent to/);
  } finally {
    await home.cleanup();
  }
});

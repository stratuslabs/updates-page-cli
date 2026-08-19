/**
 * Sign-in, end to end against a stand-in server.
 */

import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { after, before, test } from 'node:test';

import { credentialsPath, saveCredential, type CredentialsFile } from '../src/core/credentials.ts';
import { EXIT } from '../src/core/errors.ts';
import { stripAnsi } from '../src/core/theme.ts';
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

test('--token - reads the token from stdin, never from argv', async () => {
  const home = await createTempHome();
  try {
    // The reason this exists: a token passed as an argument is saved in shell
    // history and readable from the process list.
    const result = await run({
      argv: ['login', '--token', '-'],
      stdin: ['tok_test'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.equal(result.exitCode, EXIT.ok, result.output.plain);
    assert.equal((await readStore(home.path)).profiles['default']?.token, 'tok_test');
  } finally {
    await home.cleanup();
  }
});

test('a token the server rejects is not saved', async () => {
  const home = await createTempHome();
  try {
    const result = await run({
      argv: ['login', '--token', '-'],
      stdin: ['tok_definitely_not_valid'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.equal(result.exitCode, EXIT.auth);
    // Saving a bad token turns every later command into a confusing 401.
    await assert.rejects(readStore(home.path));
  } finally {
    await home.cleanup();
  }
});

test('UPDATESPAGE_TOKEN authenticates without any stored credential', async () => {
  const home = await createTempHome();
  try {
    // The unattended path: CI sets this and never runs `login` at all.
    const result = await run({
      argv: ['list', '--json'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url, UPDATESPAGE_TOKEN: 'tok_test' },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.equal(result.exitCode, EXIT.ok, result.output.plain);
    assert.equal((JSON.parse(result.output.stdout) as { ok: boolean }).ok, true);
  } finally {
    await home.cleanup();
  }
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

test('login replaces an expired credential instead of refusing', async () => {
  const home = await createTempHome();
  try {
    await saveCredential(home.path, 'updatespage', 'default', {
      token: 'tok_stale',
      baseUrl: server.url,
      // Both before the harness's frozen clock (2026-01-01), which is what
      // decides expiry here — not the wall clock.
      createdAt: '2025-12-01T00:00:00.000Z',
      expiresAt: '2025-12-31T00:00:00.000Z',
    });

    // Without this, `login` was the one command an expired credential broke,
    // and the error it raised said to run `login`.
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
    const stored = (await readStore(home.path)).profiles['default'];
    assert.notEqual(stored?.token, 'tok_stale');
    // Whatever expiry the new credential carries, it is not the lapsed one.
    assert.ok(
      stored?.expiresAt === undefined ||
        Date.parse(stored.expiresAt) > Date.parse('2026-01-01T00:00:00.000Z'),
      String(stored?.expiresAt),
    );
  } finally {
    await home.cleanup();
  }
});

test('login works when a stored token is bound to another endpoint', async () => {
  const home = await createTempHome();
  try {
    // Signing in for a new endpoint is the whole reason you would run this.
    await saveCredential(home.path, 'updatespage', 'default', {
      token: 'tok_elsewhere',
      baseUrl: 'https://somewhere-else.example',
      createdAt: new Date().toISOString(),
    });

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
    assert.equal((await readStore(home.path)).profiles['default']?.baseUrl, server.url);
  } finally {
    await home.cleanup();
  }
});

test('logout with $UPDATESPAGE_TOKEN set leaves the saved profile alone', async () => {
  const home = await createTempHome();
  try {
    // Both credentials exist and are valid. The env one is what openSession
    // selects, so it is the one that gets revoked.
    server.tokens.add('tok_from_env');
    await saveCredential(home.path, 'updatespage', 'default', {
      token: 'tok_saved',
      baseUrl: server.url,
      createdAt: '2025-12-01T00:00:00.000Z',
    });
    server.tokens.add('tok_saved');

    const result = await run({
      argv: ['logout'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url, UPDATESPAGE_TOKEN: 'tok_from_env' },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.equal(result.exitCode, EXIT.ok, result.output.plain);
    assert.equal(server.tokens.has('tok_from_env'), false);

    // Deleting the stored one would remove a credential the user never signed
    // out of — and leave it live on the server with no local copy left to
    // revoke it from, which is the opposite of what this command is for.
    assert.equal((await readStore(home.path)).profiles['default']?.token, 'tok_saved');
    assert.equal(server.tokens.has('tok_saved'), true);
    assert.match(stripAnsi(result.output.plain), /UPDATESPAGE_TOKEN/);
  } finally {
    await home.cleanup();
  }
});

test('logout without an env token still removes the saved credential', async () => {
  const home = await createTempHome();
  try {
    // The other half, so the guard cannot just stop deleting entirely.
    await saveCredential(home.path, 'updatespage', 'default', {
      token: 'tok_only',
      baseUrl: server.url,
      createdAt: '2025-12-01T00:00:00.000Z',
    });
    server.tokens.add('tok_only');

    const result = await run({
      argv: ['logout'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      fetch: globalThis.fetch,
    });

    assert.equal(result.exitCode, EXIT.ok, result.output.plain);
    assert.equal(server.tokens.has('tok_only'), false);
    assert.equal((await readStore(home.path)).profiles['default'], undefined);
  } finally {
    await home.cleanup();
  }
});

test('cancelling the verification does not save the token and report success', async () => {
  const home = await createTempHome();
  try {
    // Save-on-unreachable is a judgement about the server. Ctrl-C is not
    // evidence about the server, and treating it as such saved the credential
    // and exited 0 — the one outcome the user was trying to prevent.
    const controller = new AbortController();
    const result = await run({
      argv: ['login', '--token', '-'],
      stdin: ['tok_test'],
      processEnv: { UPDATESPAGE_BASE_URL: server.url },
      homeDir: home.path,
      signal: controller.signal,
      fetch: (input, init) => {
        // The identity probe is the only request this flow makes.
        controller.abort();
        return Promise.reject(
          init?.signal?.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }),
        );
      },
    });

    assert.equal(result.exitCode, EXIT.interrupted, result.output.plain);
    await assert.rejects(readStore(home.path));
  } finally {
    await home.cleanup();
  }
});

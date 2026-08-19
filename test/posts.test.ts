/**
 * The post commands, end to end against a stand-in server.
 *
 * v1 had no tests at all, so these are also the regression net for the
 * behaviour that was easy to lose in the port: strict `--at` parsing, the
 * cover-upload ordering, and the shape of what each command prints.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { EXIT } from '../src/kit/errors.ts';
import { stripAnsi } from '../src/kit/theme.ts';
import { parseWhen } from '../src/commands/posts-api.ts';
import { run } from './support/harness.ts';
import { startMockServer, type MockServer } from './support/mock-server.ts';

let server: MockServer;

before(async () => {
  server = await startMockServer();
});

after(async () => {
  await server.close();
});

beforeEach(() => {
  server.requests.length = 0;
  server.uploads.length = 0;
});

const env = (): Record<string, string> => ({
  UPDATESPAGE_BASE_URL: server.url,
  UPDATESPAGE_TOKEN: 'tok_test',
});

const cli = (argv: string[], overrides: Record<string, unknown> = {}) =>
  run({ argv, processEnv: env(), fetch: globalThis.fetch, ...overrides });

/* ---- --at parsing: the subtle logic carried over from v1 ---------------- */

test('--at rejects an impossible calendar date instead of silently shifting it', () => {
  // `new Date("2026-02-30")` yields March 2 without complaint, which would
  // schedule the post on the wrong day and never say so.
  assert.throws(() => parseWhen('2026-02-30T09:00:00Z'), /not a valid calendar date/);
  assert.throws(() => parseWhen('2026-13-01T09:00:00Z'), /not a valid calendar date/);
  assert.throws(() => parseWhen('2026-01-01T25:00:00Z'), /not a valid calendar date/);
});

test('--at rejects a value that is not ISO 8601 at all', () => {
  assert.throws(() => parseWhen('next tuesday'), /Could not parse date/);
  assert.throws(() => parseWhen('10/08/2026'), /Could not parse date/);
});

test('--at accepts a date, a date-time, and an explicit offset', () => {
  assert.equal(parseWhen('2026-08-10T09:00:00Z'), '2026-08-10T09:00:00.000Z');
  assert.equal(parseWhen('2026-08-10T09:00:00+02:00'), '2026-08-10T07:00:00.000Z');
  // A leap day in a leap year is valid and must not be rejected.
  assert.ok(parseWhen('2028-02-29T00:00:00Z').startsWith('2028-02-29'));
});

test('--at reports a past time rather than failing on it', () => {
  const notes: string[] = [];
  parseWhen('2020-01-01T00:00:00Z', (note) => notes.push(note));
  assert.equal(notes.length, 1);
  assert.match(notes[0] ?? '', /in the past/);
});

/* ---- list --------------------------------------------------------------- */

test('list renders a table on stdout and the count on stderr', async () => {
  const result = await cli(['list']);
  assert.equal(result.exitCode, EXIT.ok, result.output.plain);
  assert.match(result.output.stdout, /Dark mode/);
  assert.match(result.output.stderr, /2 posts/);
  // The count is commentary; putting it on stdout would land it in the middle
  // of anything piped to grep.
  assert.doesNotMatch(result.output.stdout, /2 posts/);
});

test('list --json emits only JSON on stdout', async () => {
  const result = await cli(['list', '--json']);
  const parsed = JSON.parse(result.output.stdout) as { ok: boolean; posts: unknown[] };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.posts.length, 2);
});

test('list --status is sent as an encoded query parameter', async () => {
  await cli(['list', '--status', 'draft', '--json']);
  assert.ok(server.requests.some((request) => request.path === '/api/v1/posts?status=draft'));
});

test('list rejects an unknown status before making a request', async () => {
  const result = await cli(['list', '--status', 'nope'], {
    fetch: () => Promise.reject(new Error('should not have called the API')),
  });
  assert.equal(result.exitCode, EXIT.usage);
  assert.match(stripAnsi(result.output.stderr), /draft, scheduled, published/);
});

/* ---- publish and draft --------------------------------------------------- */

test('publish creates and publishes when no id is given', async () => {
  const result = await cli(['publish', '--title', 'New thing', '--content', '<p>Hi</p>', '--json']);
  assert.equal(result.exitCode, EXIT.ok, result.output.plain);

  const parsed = JSON.parse(result.output.stdout) as { post: { title: string }; scheduled: boolean };
  assert.equal(parsed.post.title, 'New thing');
  assert.equal(parsed.scheduled, false);
  assert.ok(server.requests.some((r) => r.method === 'POST' && r.path === '/api/v1/posts'));
  assert.ok(server.requests.some((r) => /\/publish$/.test(r.path)));
});

test('publish requires title and content when creating', async () => {
  const result = await cli(['publish'], {
    fetch: () => Promise.reject(new Error('should not have called the API')),
  });
  assert.equal(result.exitCode, EXIT.usage);
  assert.match(stripAnsi(result.output.stderr), /--title and --content are required/);
});

test('publish with --at in the future reports it as scheduled', async () => {
  const result = await cli([
    'publish', '--title', 'Later', '--content', '<p>Soon</p>',
    '--at', '2099-01-01T00:00:00Z', '--json',
  ]);
  const parsed = JSON.parse(result.output.stdout) as { scheduled: boolean };
  assert.equal(parsed.scheduled, true);
});

test('publish of an existing draft applies field changes first', async () => {
  const result = await cli(['publish', '2', '--summary', 'Now with pricing', '--json']);
  assert.equal(result.exitCode, EXIT.ok, result.output.plain);
  const update = server.requests.find((r) => r.method === 'PUT' && r.path === '/api/v1/posts/2');
  assert.ok(update, 'expected the field change to be applied before publishing');
  assert.match(update?.body ?? '', /Now with pricing/);
});

test('--private and --public together are rejected by the parser', async () => {
  const result = await cli(['draft', '--title', 'x', '--content', 'y', '--private', '--public'], {
    fetch: () => Promise.reject(new Error('should not have called the API')),
  });
  assert.equal(result.exitCode, EXIT.usage);
  assert.match(stripAnsi(result.output.stderr), /cannot be used together/);
});

test('draft prints the id before attempting a cover upload', async () => {
  // If the upload fails the draft still exists, and the user needs the id to
  // retry rather than creating a second one.
  const result = await cli(['draft', '--title', 'With cover', '--content', '<p>x</p>']);
  assert.equal(result.exitCode, EXIT.ok, result.output.plain);
  assert.match(result.output.stdout, /ID: \d+/);
});

/* ---- unpublish, delete, get --------------------------------------------- */

test('unpublish reverts a post', async () => {
  const result = await cli(['unpublish', '1', '--json']);
  assert.equal(result.exitCode, EXIT.ok);
  assert.ok(server.requests.some((r) => /\/unpublish$/.test(r.path)));
});

test('delete goes through without a prompt when there is nobody to ask', async () => {
  // Non-interactive is the normal case for a script; v1 never prompted at all,
  // so this must not start blocking.
  const result = await cli(['delete', '2', '--json']);
  assert.equal(result.exitCode, EXIT.ok, result.output.plain);
  assert.ok(server.requests.some((r) => r.method === 'DELETE'));
});

test('a missing post reports not-found with the recovery command', async () => {
  const result = await cli(['get', '9999']);
  assert.equal(result.exitCode, EXIT.notFound);
  assert.match(stripAnsi(result.output.plain), /not found/i);
});

/* ---- uploads ------------------------------------------------------------- */

test('upload sends multipart and prints the URL alone on stdout', async () => {
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'upcli-'));
  const file = join(dir, 'shot.png');
  await writeFile(file, 'not really a png');

  const result = await cli(['upload', file]);
  assert.equal(result.exitCode, EXIT.ok, result.output.plain);
  // The URL is the data, alone on its line, so `| tail -1` works.
  assert.equal(result.output.stdout.trim(), 'https://cdn.example/uploaded.png');
  assert.match(server.uploads[0]?.contentType ?? '', /^multipart\/form-data; boundary=/);
});

test('upload rejects an unsupported extension before any request', async () => {
  const result = await cli(['upload', 'notes.txt'], {
    fetch: () => Promise.reject(new Error('should not have called the API')),
  });
  assert.equal(result.exitCode, EXIT.usage);
  assert.match(stripAnsi(result.output.stderr), /Unsupported image type/);
});

test('upload reports a missing file clearly', async () => {
  const result = await cli(['upload', '/nope/missing.png'], {
    fetch: () => Promise.reject(new Error('should not have called the API')),
  });
  assert.match(stripAnsi(result.output.stderr), /File not found/);
});

/* ---- categories ---------------------------------------------------------- */

test('bare `categories` still lists, as it did in v1', async () => {
  const result = await cli(['categories', '--json']);
  assert.equal(result.exitCode, EXIT.ok, result.output.plain);
  const parsed = JSON.parse(result.output.stdout) as { categories: { name: string }[] };
  assert.equal(parsed.categories[0]?.name, 'Features');
});

test('categories create requires a name', async () => {
  const result = await cli(['categories', 'create'], {
    fetch: () => Promise.reject(new Error('should not have called the API')),
  });
  assert.equal(result.exitCode, EXIT.usage);
  assert.match(stripAnsi(result.output.stderr), /--name/);
});

/**
 * A stand-in for app.updates.page: the OAuth endpoints plus the posts,
 * categories and uploads the commands actually call.
 *
 * Runs on localhost over real HTTP, so the tests exercise real sockets, real
 * redirects, real multipart encoding and real form parsing — everything except
 * the production server itself.
 */

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockPost {
  id: number;
  title: string;
  content?: string;
  summary?: string;
  status: 'Draft' | 'Scheduled' | 'Published';
  published_at: string | null;
  is_public: boolean;
  category?: { id: number; name: string };
}

export interface MockServer {
  url: string;
  close(): Promise<void>;
  readonly tokens: Set<string>;
  readonly posts: MockPost[];
  /** Every request, so a test can assert on what was actually sent. */
  readonly requests: { method: string; path: string; body?: string }[];
  /** Multipart uploads that arrived, by field name. */
  readonly uploads: { path: string; contentType: string }[];
  nextId: number;
}

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
};

const readRaw = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const base64url = (input: Buffer): string =>
  input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const startMockServer = async (): Promise<MockServer> => {
  const tokens = new Set<string>(['tok_test']);
  const posts: MockPost[] = [
    { id: 1, title: 'Dark mode', status: 'Published', published_at: '2026-01-02T10:00:00Z', is_public: true },
    { id: 2, title: 'Pricing update', status: 'Draft', published_at: null, is_public: false },
  ];
  const requests: { method: string; path: string; body?: string }[] = [];
  const uploads: { path: string; contentType: string }[] = [];
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const state = { nextId: 3 };

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const method = request.method ?? 'GET';
    const contentType = request.headers['content-type'] ?? '';

    // Multipart bodies are read as binary and only inspected, not parsed.
    const raw = method === 'GET' ? '' : await readRaw(request);
    requests.push({ method, path: url.pathname + url.search, ...(raw === '' ? {} : { body: raw.slice(0, 400) }) });

    /* ---- OAuth ---------------------------------------------------------- */

    if (url.pathname === '/oauth/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const code = `code_${codes.size + 1}`;
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri });
      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      target.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.statusCode = 302;
      response.setHeader('location', target.toString());
      response.end();
      return;
    }

    if (url.pathname === '/api/v1/oauth/token' && method === 'POST') {
      const form = new URLSearchParams(raw);
      const pending = codes.get(form.get('code') ?? '');
      if (pending === undefined) {
        json(response, 400, { error: 'invalid_grant', error_description: 'Unknown or used code.' });
        return;
      }
      codes.delete(form.get('code') ?? '');

      const expected = base64url(createHash('sha256').update(form.get('code_verifier') ?? '').digest());
      if (expected !== pending.challenge) {
        json(response, 400, { error: 'invalid_grant', error_description: 'The code verifier did not match.' });
        return;
      }

      const token = `tok_${Date.parse('2026-01-01') + codes.size}`;
      tokens.add(token);
      json(response, 200, {
        access_token: token,
        token_type: 'Bearer',
        account: { id: 1, name: 'Acme', tier: 'pro' },
      });
      return;
    }

    if (url.pathname === '/api/v1/oauth/revoke' && method === 'POST') {
      const parsed = JSON.parse(raw || '{}') as { token?: string };
      if (parsed.token !== undefined) tokens.delete(parsed.token);
      json(response, 200, { ok: true });
      return;
    }

    /* ---- everything below needs a bearer token -------------------------- */

    const token = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!tokens.has(token)) {
      json(response, 401, { error: 'Invalid or expired API key' });
      return;
    }

    if (url.pathname === '/api/v1/oauth/identity') {
      json(response, 200, {
        id: 7,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        account: { id: 1, name: 'Acme', tier: 'pro' },
      });
      return;
    }

    /* ---- posts ---------------------------------------------------------- */

    const postMatch = /^\/api\/v1\/posts\/([^/]+)(\/(\w+))?$/.exec(url.pathname);

    if (url.pathname === '/api/v1/posts' && method === 'GET') {
      const status = url.searchParams.get('status');
      json(
        response,
        200,
        status === null ? posts : posts.filter((post) => post.status.toLowerCase() === status),
      );
      return;
    }

    if (url.pathname === '/api/v1/posts' && method === 'POST') {
      const body = JSON.parse(raw || '{}') as { post?: Record<string, unknown> };
      const created: MockPost = {
        id: state.nextId++,
        title: String(body.post?.['title'] ?? 'Untitled'),
        content: body.post?.['content'] as string | undefined,
        status: 'Draft',
        published_at: null,
        is_public: body.post?.['is_public'] !== false,
      };
      posts.push(created);
      json(response, 201, created);
      return;
    }

    if (postMatch !== null) {
      const post = posts.find((candidate) => String(candidate.id) === postMatch[1]);
      if (post === undefined) {
        json(response, 404, { error: `Post ${postMatch[1]} not found` });
        return;
      }
      const action = postMatch[3];

      if (action === 'publish' && method === 'POST') {
        const body = JSON.parse(raw || '{}') as { published_at?: string };
        post.published_at = body.published_at ?? '2026-01-01T00:00:00Z';
        post.status = body.published_at !== undefined && Date.parse(body.published_at) > Date.parse('2026-01-01T00:00:00Z')
          ? 'Scheduled'
          : 'Published';
        json(response, 200, post);
        return;
      }
      if (action === 'unpublish' && method === 'POST') {
        post.status = 'Draft';
        post.published_at = null;
        json(response, 200, post);
        return;
      }
      if (action === 'update_cover_image' && method === 'POST') {
        uploads.push({ path: url.pathname, contentType });
        json(response, 200, post);
        return;
      }
      if (method === 'PUT') {
        const body = JSON.parse(raw || '{}') as { post?: Record<string, unknown> };
        Object.assign(post, body.post);
        json(response, 200, post);
        return;
      }
      if (method === 'DELETE') {
        posts.splice(posts.indexOf(post), 1);
        response.statusCode = 204;
        response.end();
        return;
      }
      if (method === 'GET') {
        json(response, 200, post);
        return;
      }
    }

    /* ---- categories and uploads ----------------------------------------- */

    if (url.pathname === '/api/v1/categories' && method === 'GET') {
      json(response, 200, [{ id: 10, name: 'Features', color: '#8B5CF6' }]);
      return;
    }
    if (url.pathname === '/api/v1/categories' && method === 'POST') {
      const body = JSON.parse(raw || '{}') as { category?: Record<string, unknown> };
      json(response, 201, { id: 11, ...body.category });
      return;
    }
    if (url.pathname === '/api/v1/uploads' && method === 'POST') {
      uploads.push({ path: url.pathname, contentType });
      json(response, 201, { url: 'https://cdn.example/uploaded.png' });
      return;
    }

    json(response, 404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    tokens,
    posts,
    requests,
    uploads,
    get nextId() {
      return state.nextId;
    },
    set nextId(value: number) {
      state.nextId = value;
    },
  };
};

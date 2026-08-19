/**
 * Shared plumbing for commands that talk to the API: which endpoint, which
 * credential. One implementation, so the endpoint binding cannot be forgotten
 * in a second copy.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { APP, baseUrlEnvName, resolveAuthProvider, resolveBaseUrl, tokenEnvName } from '../app.ts';
import type { RunContext } from '../kit/context.ts';
import {
  DEFAULT_PROFILE,
  loadCredentials,
  resolveCredential,
  type CredentialsFile,
} from '../kit/credentials.ts';
import { AuthError } from '../kit/errors.ts';
import { HttpClient } from '../kit/http.ts';

/**
 * Where v1 kept its key: `~/.updatespage/config.json`, shaped `{"apiKey": "…"}`.
 *
 * Still read, so upgrading does not silently sign everyone out. It is only a
 * fallback — anything in `credentials.json` wins — and `login` writes the new
 * format, so the legacy file quietly stops mattering after the next sign-in.
 */
export const legacyConfigPath = (homeDir: string): string =>
  join(homeDir, `.${APP.brand}`, 'config.json');

export const readLegacyApiKey = async (homeDir: string): Promise<string | undefined> => {
  try {
    const raw = await readFile(legacyConfigPath(homeDir), 'utf8');
    const parsed = JSON.parse(raw) as { apiKey?: unknown };
    return typeof parsed.apiKey === 'string' && parsed.apiKey !== '' ? parsed.apiKey : undefined;
  } catch {
    // Missing or unreadable is the normal case for anyone who never used v1.
    return undefined;
  }
};

export interface Session {
  http: HttpClient;
  provider: ReturnType<typeof resolveAuthProvider>;
  baseUrl: string;
  baseUrlOrigin: string;
  profile: string;
  token: string | undefined;
  tokenSource: string | undefined;
  credentials: CredentialsFile;
}

export const profileName = (ctx: RunContext): string => ctx.globals.profile ?? DEFAULT_PROFILE;

export const openSession = async (
  ctx: RunContext,
  options: { require?: boolean } = {},
): Promise<Session> => {
  const profile = profileName(ctx);
  const base = resolveBaseUrl(APP, ctx.flags);
  const credentials = await loadCredentials(ctx.env.homeDir, APP.brand);

  const envValue = ctx.env.processEnv[tokenEnvName(APP)];
  let resolved = resolveCredential(credentials, {
    profile,
    baseUrl: base.value,
    baseUrlOrigin: base.origin,
    baseUrlTrusted: base.trusted,
    ...(envValue === undefined || envValue === ''
      ? {}
      : { envToken: { name: tokenEnvName(APP), value: envValue } }),
    now: ctx.env.now(),
  });

  // Only consulted when nothing newer exists, and only for the default
  // profile — a v1 key predates profiles, so attributing it to a named one
  // would be inventing a fact.
  if (resolved === undefined && profile === DEFAULT_PROFILE) {
    const legacy = await readLegacyApiKey(ctx.env.homeDir);
    if (legacy !== undefined) {
      resolved = { token: legacy, source: '~/.updatespage/config.json (v1)' };
    }
  }

  if (options.require === true && resolved === undefined) {
    throw new AuthError('auth.not_signed_in', `You are not signed in to ${APP.auth.displayName}.`, {
      hint: `Run \`${APP.name} login\`, or set $${tokenEnvName(APP)}.`,
      details: { profile, baseUrl: base.value },
    });
  }

  return {
    provider: resolveAuthProvider(APP, ctx.flags),
    http: new HttpClient({
      baseUrl: base.value,
      fetch: ctx.env.fetch,
      userAgent: `${APP.name}/${APP.version}`,
      ...(resolved === undefined ? {} : { token: resolved.token }),
      signal: ctx.signal,
    }),
    baseUrl: base.value,
    baseUrlOrigin: base.origin,
    profile,
    token: resolved?.token,
    tokenSource: resolved?.source,
    credentials,
  };
};

export interface Identity {
  id?: number | string;
  name?: string;
  email?: string;
  account?: { id?: number | string; name?: string; tier?: string };
}

export const fetchIdentity = async (session: Session): Promise<Identity | undefined> => {
  if (session.provider.identityUrl === undefined) return undefined;
  return session.http.get<Identity>(session.provider.identityUrl);
};

export const describeIdentity = (identity: Identity | undefined): string => {
  if (identity === undefined) return 'an unknown account';
  const who = identity.name ?? identity.email ?? String(identity.id ?? 'unknown');
  return identity.account?.name === undefined ? who : `${who} (${identity.account.name})`;
};

export { baseUrlEnvName };

/**
 * Shared plumbing for commands that talk to the API: which endpoint, which
 * credential. One implementation, so the endpoint binding cannot be forgotten
 * in a second copy.
 */

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

export interface Session {
  http: HttpClient;
  provider: ReturnType<typeof resolveAuthProvider>;
  baseUrl: string;
  baseUrlOrigin: string;
  profile: string;
  token: string | undefined;
  tokenSource: string | undefined;
  /** 'env' or 'profile' — see ResolvedCredential. Undefined when unsigned. */
  tokenOrigin: 'env' | 'profile' | undefined;
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
  const resolved = resolveCredential(credentials, {
    profile,
    baseUrl: base.value,
    baseUrlOrigin: base.origin,
    baseUrlTrusted: base.trusted,
    ...(envValue === undefined || envValue === ''
      ? {}
      : { envToken: { name: tokenEnvName(APP), value: envValue } }),
    now: ctx.env.now(),
  });

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
    tokenOrigin: resolved?.origin,
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

/**
 * Branding and endpoints. Everything that makes this CLI *this* CLI is here.
 *
 * Built from stratuslabs/cli-kit — `src/kit/` is that framework, unmodified,
 * so improvements can be pulled from upstream without re-applying anything
 * here. `src/commands/` is ours.
 */

import type { AuthProvider } from './kit/auth/provider.ts';
import type { FlagBag } from './kit/context.ts';
import { CLI_VERSION } from './kit/version.ts';

export interface AppConfig {
  name: string;
  brand: string;
  version: string;
  summary: string;
  envPrefix: string;
  auth: AuthProvider;
  footer?: string;
}

/**
 * Accounts with a custom changelog domain still authenticate and publish
 * through the hosted app — the custom domain only serves the public portal.
 */
const DEFAULT_BASE_URL = 'https://app.updates.page';

export const APP: AppConfig = {
  name: 'updates',
  // Keeps the existing `~/.updatespage/` directory, so upgrading does not
  // strand anyone's saved key somewhere the CLI no longer looks.
  brand: 'updatespage',
  version: CLI_VERSION,
  summary: 'Publish changelog posts from your terminal.',
  envPrefix: 'UPDATESPAGE',
  auth: {
    displayName: 'updates.page',
    baseUrl: DEFAULT_BASE_URL,
    authorizeUrl: `${DEFAULT_BASE_URL}/oauth/authorize`,
    tokenUrl: `${DEFAULT_BASE_URL}/api/v1/oauth/token`,
    deviceCodeUrl: `${DEFAULT_BASE_URL}/api/v1/oauth/device/code`,
    identityUrl: `${DEFAULT_BASE_URL}/api/v1/oauth/identity`,
    revokeUrl: `${DEFAULT_BASE_URL}/api/v1/oauth/revoke`,
    tokenHelpUrl: `${DEFAULT_BASE_URL}/account/api-keys`,
    clientId: 'updates-cli',
  },
};

/** The global flag naming the API endpoint. Declared once, in main.ts. */
export const BASE_URL_FLAG = 'base-url';

export const tokenEnvName = (app: AppConfig = APP): string => `${app.envPrefix}_TOKEN`;
export const baseUrlEnvName = (app: AppConfig = APP): string => `${app.envPrefix}_BASE_URL`;
export const configEnvName = (app: AppConfig = APP): string => `${app.envPrefix}_CONFIG`;

/**
 * The auth provider with the endpoint override applied to **every** URL.
 *
 * Rewriting only `baseUrl` and leaving the derived URLs on the default is a
 * bug with a confusing symptom: sign-in succeeds against the endpoint you
 * asked for, then `whoami` fails against a host you never named.
 */
export const resolveAuthProvider = (app: AppConfig, flags: FlagBag): AuthProvider => {
  const base = resolveBaseUrl(app, flags);
  if (base.value === app.auth.baseUrl) return app.auth;

  const swap = (url: string): string =>
    url.startsWith(app.auth.baseUrl) ? `${base.value}${url.slice(app.auth.baseUrl.length)}` : url;

  return {
    ...app.auth,
    baseUrl: base.value,
    authorizeUrl: swap(app.auth.authorizeUrl),
    tokenUrl: swap(app.auth.tokenUrl),
    ...(app.auth.deviceCodeUrl === undefined ? {} : { deviceCodeUrl: swap(app.auth.deviceCodeUrl) }),
    ...(app.auth.identityUrl === undefined ? {} : { identityUrl: swap(app.auth.identityUrl) }),
    ...(app.auth.revokeUrl === undefined ? {} : { revokeUrl: swap(app.auth.revokeUrl) }),
  };
};

export const resolveBaseUrl = (
  app: AppConfig,
  flags: FlagBag,
): { value: string; origin: string; trusted: boolean } => {
  // The environment fallback is declared on the flag and applied by the
  // parser, so precedence and provenance have exactly one implementation.
  const value = flags.string(BASE_URL_FLAG);
  if (value !== undefined && value !== '') {
    return { value, origin: flags.origin(BASE_URL_FLAG), trusted: true };
  }
  return { value: app.auth.baseUrl, origin: 'built-in default', trusted: true };
};

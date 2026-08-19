/**
 * The updates.page API shapes, and the two pieces of v1 logic worth keeping
 * verbatim: strict date parsing and the skew-tolerant status rendering.
 */

import { existsSync, openAsBlob } from 'node:fs';
import { basename, extname } from 'node:path';

import { CliError, UsageError } from '../kit/errors.ts';
import type { Theme } from '../kit/theme.ts';

export interface Post {
  id: number | string;
  title: string;
  content?: string;
  summary?: string;
  status?: string;
  published_at?: string | null;
  is_public?: boolean;
  override_url?: string;
  portal_url?: string;
  category?: { id?: number | string; name?: string };
}

export interface Category {
  id: number | string;
  name: string;
  color?: string;
}

/** The server validates these, so the client should not send anything else. */
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Build a one-file multipart body, checking the file locally first.
 *
 * Catching a bad extension or a missing path here turns a slow round trip and
 * a server-side 422 into an instant, specific message.
 */
export const fileFormData = async (fieldName: string, filePath: string): Promise<FormData> => {
  const extension = extname(filePath).toLowerCase();
  const mime = IMAGE_MIME_TYPES[extension];

  if (mime === undefined) {
    throw new UsageError(`Unsupported image type "${extension || filePath}".`, {
      hint: `Use one of: ${Object.keys(IMAGE_MIME_TYPES).join(', ')}`,
    });
  }
  if (!existsSync(filePath)) {
    throw new CliError('file.not_found', `File not found: ${filePath}`, {
      hint: 'Check the path and try again.',
    });
  }

  const form = new FormData();
  form.append(fieldName, await openAsBlob(filePath, { type: mime }), basename(filePath));
  return form;
};

export const POST_STATUSES = ['draft', 'scheduled', 'published'];

/**
 * Parse an `--at` value: strict ISO 8601, date with optional time and zone.
 *
 * Strictness is the point. `new Date()` silently normalizes impossible dates —
 * `2026-02-30` becomes March 2 — which would schedule a post on the wrong day
 * without ever reporting a problem.
 */
export const parseWhen = (value: string, onPastTime?: (message: string) => void): string => {
  const match = String(value)
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?)?(Z|[+-]\d{2}:?\d{2})?$/,
    );

  if (match === null) {
    throw new UsageError(`Could not parse date "${value}".`, {
      hint: 'Use ISO 8601, e.g. 2026-08-10T09:00:00Z',
    });
  }

  const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', zone] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();

  if (
    Number(month) < 1 || Number(month) > 12 ||
    Number(day) < 1 || Number(day) > daysInMonth ||
    Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
  ) {
    throw new UsageError(`"${value}" is not a valid calendar date/time.`);
  }

  const normalizedZone = zone === undefined ? '' : zone === 'Z' ? 'Z' : zone.replace(/(\d{2})(\d{2})$/, '$1:$2');
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${normalizedZone}`);

  if (Number.isNaN(date.getTime())) {
    throw new UsageError(`Could not parse date "${value}".`, {
      hint: 'Use ISO 8601, e.g. 2026-08-10T09:00:00Z',
    });
  }

  // A zone-less value is local time, and a spring-forward DST gap (02:30 on
  // the switch night) silently shifts an hour. Round-tripping the components
  // makes a nonexistent time an error instead of a surprise.
  if (
    zone === undefined &&
    (date.getFullYear() !== Number(year) ||
      date.getMonth() + 1 !== Number(month) ||
      date.getDate() !== Number(day) ||
      date.getHours() !== Number(hour) ||
      date.getMinutes() !== Number(minute))
  ) {
    throw new UsageError(`"${value}" is not a valid local time (it falls in a DST transition gap).`);
  }

  if (date.getTime() <= Date.now()) {
    onPastTime?.('That time is in the past — the post will go live immediately.');
  }

  return date.toISOString();
};

/**
 * An immediate publish has its `published_at` stamped by the server, which can
 * sit a few seconds ahead of the local clock. Anything inside this window is
 * already published, not scheduled.
 */
const CLOCK_SKEW_MS = 60 * 1000;

export const isScheduled = (post: Post, now: Date): boolean => {
  // The server's own status is authoritative; the time comparison is only a
  // fallback for responses that omit it.
  if (post.status !== undefined) return post.status.toLowerCase() === 'scheduled';
  if (post.published_at == null) return false;
  return new Date(post.published_at).getTime() > now.getTime() + CLOCK_SKEW_MS;
};

export const postStatus = (post: Post, now: Date): string => {
  if (post.status !== undefined) return post.status.toLowerCase();
  if (post.published_at == null) return 'draft';
  return isScheduled(post, now) ? 'scheduled' : 'published';
};

/**
 * The status marker.
 *
 * v1 used emoji unconditionally, which renders as replacement boxes in CI
 * logs, in the legacy Windows console, and under a non-UTF-8 locale. The
 * theme's glyphs degrade to ASCII on exactly those terminals.
 */
export const statusGlyph = (post: Post, theme: Theme, now: Date): string => {
  const status = postStatus(post, now);
  if (status === 'published') return theme.success(theme.glyph.tick);
  if (status === 'scheduled') return theme.warning(theme.glyph.bullet);
  return theme.muted(theme.glyph.dot);
};

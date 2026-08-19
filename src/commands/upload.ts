/**
 * `updates upload <file>` — put an image on the CDN and print its URL, for
 * pasting into post content.
 */

import { defineCommand } from '../core/command.ts';
import { fileFormData } from './posts-api.ts';
import { openSession } from './session.ts';

export const uploadCommand = defineCommand({
  name: 'upload',
  summary: 'upload an image and print its public URL',
  description:
    'Uploads an image and prints the URL to paste into a post body. ' +
    'For a post cover image use --cover-image on publish/draft/update instead.',
  args: [{ name: 'file', summary: 'image to upload (png/jpg/gif/webp)', required: true }],
  examples: [
    { cmd: 'upload screenshot.png', note: 'get a URL for the post body' },
    { cmd: 'upload shot.png --json | jq -r .url', note: 'straight into a script' },
  ],

  async run(ctx) {
    const path = ctx.args[0] ?? '';
    const session = await openSession(ctx, { require: true });

    // Validated locally first, so a wrong extension fails instantly rather
    // than after a round trip.
    const form = await fileFormData('file', path);
    const result = await session.http.post<{ url: string }>('/api/v1/uploads', { body: form });

    ctx.emit({ ok: true, url: result.url });
    if (ctx.globals.json) return;

    ctx.say(ctx.theme.ok('Image uploaded'));
    // The URL is the data — on stdout, alone on its line, so `| tail -1` works.
    ctx.out(result.url);
  },
});

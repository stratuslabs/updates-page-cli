/**
 * `updates config --api-key <key>` — how v1 authenticated.
 *
 * Kept working so upgrading does not break anyone's setup, but hidden from
 * help and it now says what to use instead. The key lands in shell history and
 * is visible to any process that can read the process list, which is the whole
 * reason `login` exists.
 */

import { defineCommand } from '../kit/command.ts';
import { APP } from '../app.ts';
import { saveCredential } from '../kit/credentials.ts';
import { profileName } from './session.ts';

export const configCommand = defineCommand({
  name: 'config',
  summary: 'save an API key (deprecated — use `updates login`)',
  description:
    'Saves an API key directly. Deprecated: a key passed on the command line ' +
    'is recorded in your shell history and is visible to other processes. ' +
    '`updates login` signs you in through the browser instead, and stores the ' +
    'token with the same 0600 permissions.',
  hidden: true,
  flags: {
    'api-key': {
      type: 'string',
      placeholder: '<key>',
      summary: 'the API key to save',
      required: true,
    },
  },

  async run(ctx) {
    ctx.say(ctx.theme.warn('`config --api-key` is deprecated.'));
    ctx.say(
      ctx.theme.muted(
        `  A key typed here is saved in your shell history. Prefer: ${ctx.program.name} login`,
      ),
    );

    // Written in the new format, so the next command finds it the normal way
    // and the legacy config.json stops being consulted.
    await saveCredential(ctx.env.homeDir, APP.brand, profileName(ctx), {
      token: ctx.flags.requireString('api-key'),
      baseUrl: APP.auth.baseUrl,
      createdAt: ctx.env.now().toISOString(),
    });

    ctx.say(ctx.theme.ok(`Saved to ~/.${APP.brand}/credentials.json (0600).`));
    ctx.emit({ ok: true });
  },
});

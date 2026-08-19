/**
 * The command registry, and the entry point tests call.
 */

import { APP, BASE_URL_FLAG, baseUrlEnvName } from './app.ts';
import type { ProgramDef } from './kit/command.ts';
import type { CliEnvironment, CliStreams } from './kit/env.ts';
import { GLOBAL_FLAGS, runCli } from './kit/run.ts';

import { categoriesCommand } from './commands/categories.ts';
import { configCommand } from './commands/config.ts';
import { doctorCommand } from './commands/doctor.ts';
import { loginCommand } from './commands/login.ts';
import { logoutCommand } from './commands/logout.ts';
import {
  deleteCommand,
  draftCommand,
  getCommand,
  listCommand,
  publishCommand,
  unpublishCommand,
  updateCommand,
} from './commands/posts.ts';
import { uploadCommand } from './commands/upload.ts';
import { whoamiCommand } from './commands/whoami.ts';

export const program: ProgramDef = {
  name: APP.name,
  version: APP.version,
  summary: APP.summary,
  globalFlags: {
    ...GLOBAL_FLAGS,
    config: {
      type: 'string',
      placeholder: '<path>',
      summary: 'use a specific config file',
      env: `${APP.envPrefix}_CONFIG`,
    },
    [BASE_URL_FLAG]: {
      type: 'string',
      placeholder: '<url>',
      summary: 'talk to a different endpoint (for testing against a local app)',
      env: baseUrlEnvName(APP),
    },
  },
  // Ordered as someone would meet them: publishing first, then reading, then
  // account plumbing. `config` is hidden — it is the deprecated v1 path.
  commands: [
    publishCommand,
    draftCommand,
    updateCommand,
    unpublishCommand,
    deleteCommand,
    listCommand,
    getCommand,
    categoriesCommand,
    uploadCommand,
    loginCommand,
    logoutCommand,
    whoamiCommand,
    doctorCommand,
    configCommand,
  ],
  footer: 'Docs: https://updates.page/docs · Built with https://github.com/stratuslabs/cli-kit',
};

export const main = (options: {
  argv: readonly string[];
  streams: CliStreams;
  env: CliEnvironment;
}): Promise<number> => runCli(program, options);

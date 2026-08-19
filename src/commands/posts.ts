/**
 * The post commands: publish, draft, update, unpublish, delete, list, get.
 *
 * The command surface is unchanged from v1 — same names, same flags, same
 * argument shapes — so existing scripts keep working. What changed is that
 * every one of them now supports `--json`, failures carry an exit code and a
 * hint, and the field flags are declared once in a shared object rather than
 * re-listed per command.
 */

import { defineCommand, type FlagDef } from '../kit/command.ts';
import type { RunContext } from '../kit/context.ts';
import { CliError, UsageError } from '../kit/errors.ts';
import { definitionList, plural, table } from '../kit/render.ts';
import {
  fileFormData,
  isScheduled,
  parseWhen,
  postStatus,
  POST_STATUSES,
  statusGlyph,
  type Post,
} from './posts-api.ts';
import { openSession, type Session } from './session.ts';

/**
 * The fields publish/draft/update share.
 *
 * Declared once. v1 had a `withPostFieldOptions` mixin that did the same job;
 * here the registry consumes the object directly, so help and parsing read the
 * same source.
 */
const POST_FIELD_FLAGS: Record<string, FlagDef> = {
  title: { type: 'string', placeholder: '<title>', summary: 'post title' },
  content: { type: 'string', placeholder: '<html>', summary: 'post body (HTML or plain text)' },
  'category-id': {
    type: 'string',
    placeholder: '<id>',
    summary: 'file the post under a category (find ids with `updates categories`)',
  },
  summary: { type: 'string', placeholder: '<text>', summary: 'short summary shown in feeds and embeds' },
  url: {
    type: 'string',
    placeholder: '<url>',
    summary: 'link this post to an external page instead of the changelog entry',
  },
  private: {
    type: 'boolean',
    summary: 'hide this post from the public changelog and embeds',
    conflictsWith: ['public'],
  },
  public: {
    type: 'boolean',
    summary: 'show this post on the public changelog',
    conflictsWith: ['private'],
  },
  'cover-image': {
    type: 'string',
    placeholder: '<path>',
    summary: 'set the cover image from a local file (png/jpg/gif/webp)',
  },
};

interface PostFields {
  title?: string;
  content?: string;
  category_id?: string;
  summary?: string;
  override_url?: string;
  is_public?: boolean;
}

/** Only the flags actually supplied — an absent flag must not blank a field. */
const collectPostFields = (ctx: RunContext): PostFields => {
  const fields: PostFields = {};
  const title = ctx.flags.string('title');
  const content = ctx.flags.string('content');
  const categoryId = ctx.flags.string('category-id');
  const summary = ctx.flags.string('summary');
  const url = ctx.flags.string('url');

  if (title !== undefined) fields.title = title;
  if (content !== undefined) fields.content = content;
  if (categoryId !== undefined) fields.category_id = categoryId;
  if (summary !== undefined) fields.summary = summary;
  if (url !== undefined) fields.override_url = url;
  // `--private` and `--public` are declared as conflicting, so the parser has
  // already rejected both together.
  if (ctx.flags.boolean('private')) fields.is_public = false;
  if (ctx.flags.boolean('public')) fields.is_public = true;

  return fields;
};

const createPost = (session: Session, fields: PostFields): Promise<Post> =>
  session.http.post<Post>('/api/v1/posts', { body: { post: fields } });

const updatePost = (session: Session, id: string, fields: PostFields): Promise<Post> =>
  session.http.put<Post>(`/api/v1/posts/${encodeURIComponent(id)}`, { body: { post: fields } });

const setCoverImage = async (session: Session, id: string, path: string): Promise<Post> =>
  session.http.post<Post>(`/api/v1/posts/${encodeURIComponent(id)}/update_cover_image`, {
    body: await fileFormData('post[cover_image]', path),
  });

const publishPost = (session: Session, id: string, publishedAt: string | null): Promise<Post> =>
  session.http.post<Post>(`/api/v1/posts/${encodeURIComponent(id)}/publish`, {
    ...(publishedAt === null ? {} : { body: { published_at: publishedAt } }),
  });

/** The `✓ …` + indented detail block v1 printed, so scripts see what they saw. */
const printSummary = (ctx: RunContext, headline: string, rows: [string, string][]): void => {
  ctx.say(ctx.theme.ok(headline));
  for (const [label, value] of rows) ctx.out(`  ${label}: ${value}`);
};

export const publishCommand = defineCommand({
  name: 'publish',
  summary: 'publish a post, or schedule one',
  description:
    'Creates a post and publishes it, or publishes an existing draft by id. ' +
    'With --at, the post goes live at that time instead of now.',
  args: [{ name: 'id', summary: 'an existing draft to publish (omit to create a new post)' }],
  flags: {
    ...POST_FIELD_FLAGS,
    at: {
      type: 'string',
      placeholder: '<datetime>',
      summary: 'schedule: go live at this ISO 8601 time instead of now',
    },
  },
  examples: [
    { cmd: 'publish --title "Dark mode" --content "<p>It is here</p>"', note: 'create and publish' },
    { cmd: 'publish 123', note: 'publish an existing draft' },
    { cmd: 'publish 123 --at 2026-09-01T09:00:00Z', note: 'schedule an existing draft' },
  ],

  async run(ctx) {
    const session = await openSession(ctx, { require: true });
    const at = ctx.flags.string('at');
    const publishedAt = at === undefined ? null : parseWhen(at, (note) => ctx.say(ctx.theme.muted(`  ${note}`)));

    const [existingId] = ctx.args;
    const coverImage = ctx.flags.string('cover-image');
    let postId: string;

    if (existingId !== undefined) {
      const changes = collectPostFields(ctx);
      if (Object.keys(changes).length > 0) await updatePost(session, existingId, changes);
      postId = existingId;
    } else {
      const fields = collectPostFields(ctx);
      if (fields.title === undefined || fields.content === undefined) {
        throw new UsageError('--title and --content are required when creating a new post.', {
          hint: `To publish an existing draft instead: ${ctx.program.name} publish <id>`,
        });
      }
      postId = String((await createPost(session, fields)).id);
    }

    // The cover upload happens while the post is still a draft. A bad path or
    // a server rejection must not leave a half-configured post live — and the
    // error names the id, so a retry does not create a duplicate.
    if (coverImage !== undefined) {
      try {
        await setCoverImage(session, postId, coverImage);
        ctx.say(ctx.theme.ok('Cover image set'));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CliError('post.cover_failed', detail, {
          hint:
            `The post was NOT published and is saved as a draft (id ${postId}). ` +
            `Fix the image and run: ${ctx.program.name} publish ${postId} --cover-image <path>`,
          cause: error,
          details: { postId },
        });
      }
    }

    const post = await publishPost(session, postId, publishedAt);

    // --at with a future time is the only way to schedule; everything else is
    // an immediate publish, whatever the server's clock says.
    const scheduled = publishedAt !== null && new Date(publishedAt).getTime() > ctx.env.now().getTime();

    ctx.emit({ ok: true, scheduled, post });
    if (ctx.globals.json) return;

    printSummary(ctx, scheduled ? 'Post scheduled' : 'Post published', [
      ['ID', String(post.id)],
      ['Title', post.title],
      [scheduled ? 'Goes live' : 'Published', String(post.published_at ?? 'now')],
    ]);
  },
});

export const draftCommand = defineCommand({
  name: 'draft',
  summary: 'create a draft post',
  flags: POST_FIELD_FLAGS,
  examples: [{ cmd: 'draft --title "WIP" --content "<p>Notes</p>"', note: 'save without publishing' }],

  async run(ctx) {
    const fields = collectPostFields(ctx);
    if (fields.title === undefined || fields.content === undefined) {
      throw new UsageError('--title and --content are required.');
    }

    const session = await openSession(ctx, { require: true });
    const post = await createPost(session, fields);

    // The id is printed before the cover upload on purpose: if the upload
    // fails, the draft exists and the user needs the id to retry rather than
    // creating a second one.
    if (!ctx.globals.json) {
      printSummary(ctx, 'Draft created', [['ID', String(post.id)], ['Title', post.title]]);
    }

    const coverImage = ctx.flags.string('cover-image');
    if (coverImage !== undefined) {
      try {
        await setCoverImage(session, String(post.id), coverImage);
        ctx.say(ctx.theme.ok('Cover image set'));
      } catch (error) {
        // Under --json the line above never printed, so this error is the only
        // thing the caller sees — and without the id in it, a script cannot
        // retry against the draft that now exists and will make a second one.
        // Same shape as the publish path, for the same reason.
        const detail = error instanceof Error ? error.message : String(error);
        throw new CliError('post.cover_failed', detail, {
          hint:
            `The draft was created (id ${post.id}). Fix the image and run: ` +
            `${ctx.program.name} update ${post.id} --cover-image <path>`,
          cause: error,
          details: { postId: post.id },
        });
      }
    }

    ctx.emit({ ok: true, post });
  },
});

export const updateCommand = defineCommand({
  name: 'update',
  summary: 'change fields on an existing post',
  args: [{ name: 'id', summary: 'the post to change', required: true }],
  flags: POST_FIELD_FLAGS,
  examples: [{ cmd: 'update 123 --summary "Now with dark mode"', note: 'change one field' }],

  async run(ctx) {
    const id = ctx.args[0] ?? '';
    const changes = collectPostFields(ctx);
    const coverImage = ctx.flags.string('cover-image');

    if (Object.keys(changes).length === 0 && coverImage === undefined) {
      throw new UsageError('Nothing to update.', {
        hint: `Pass at least one field flag — see \`${ctx.program.name} update --help\`.`,
      });
    }

    const session = await openSession(ctx, { require: true });
    let post: Post | undefined;

    if (Object.keys(changes).length > 0) post = await updatePost(session, id, changes);
    if (coverImage !== undefined) {
      await setCoverImage(session, id, coverImage);
      ctx.say(ctx.theme.ok('Cover image set'));
      // Re-read rather than trusting the upload response to be a whole post:
      // v1 printed whatever that endpoint returned, which is not guaranteed
      // to have the same shape.
      post = await session.http.get<Post>(`/api/v1/posts/${encodeURIComponent(id)}`);
    }

    ctx.emit({ ok: true, post });
    if (ctx.globals.json || post === undefined) return;

    ctx.say(ctx.theme.ok('Post updated'));
    for (const line of renderPost(ctx, post, false)) ctx.out(line);
  },
});

export const unpublishCommand = defineCommand({
  name: 'unpublish',
  summary: 'revert a published or scheduled post to a draft',
  args: [{ name: 'id', summary: 'the post to revert', required: true }],

  async run(ctx) {
    const id = ctx.args[0] ?? '';
    const session = await openSession(ctx, { require: true });
    await session.http.post(`/api/v1/posts/${encodeURIComponent(id)}/unpublish`);

    ctx.emit({ ok: true, id });
    if (ctx.globals.json) return;
    printSummary(ctx, 'Post reverted to draft', [['ID', id]]);
  },
});

export const deleteCommand = defineCommand({
  name: 'delete',
  summary: 'delete a post permanently',
  args: [{ name: 'id', summary: 'the post to delete', required: true }],
  flags: {
    yes: { type: 'boolean', summary: 'skip the confirmation prompt', hidden: true },
  },

  async run(ctx) {
    const id = ctx.args[0] ?? '';
    const session = await openSession(ctx, { require: true });

    // Irreversible, so ask — but only when there is somebody to ask. Under
    // --yes, --quiet, --json, or a pipe this goes straight through, which is
    // what v1 always did.
    if (!ctx.globals.yes && ctx.prompt.isInteractive()) {
      const confirmed = await ctx.prompt.confirm({
        message: `Delete post ${id}? This cannot be undone.`,
        initial: false,
      });
      if (!confirmed) {
        ctx.say(ctx.theme.muted('Nothing was deleted.'));
        return;
      }
    }

    await session.http.delete(`/api/v1/posts/${encodeURIComponent(id)}`);

    ctx.emit({ ok: true, id });
    if (ctx.globals.json) return;
    printSummary(ctx, 'Post deleted', [['ID', id]]);
  },
});

export const listCommand = defineCommand({
  name: 'list',
  summary: 'list your posts',
  description: 'Lists posts, newest first. Use --json to get ids for a script.',
  flags: {
    status: {
      type: 'string',
      placeholder: '<status>',
      summary: 'show only posts with this status',
      choices: POST_STATUSES,
    },
  },
  examples: [
    { cmd: 'list --status draft', note: 'what has not gone out yet' },
    { cmd: 'list --json | jq -r ".posts[].id"', note: 'ids, for a script' },
  ],

  async run(ctx) {
    const session = await openSession(ctx, { require: true });
    const status = ctx.flags.string('status');
    const posts = await session.http.get<Post[]>('/api/v1/posts', { query: { status } });

    ctx.emit({ ok: true, posts });
    if (ctx.globals.json) return;

    if (!Array.isArray(posts) || posts.length === 0) {
      ctx.say(ctx.theme.muted(status === undefined ? 'No posts found.' : `No ${status} posts.`));
      return;
    }

    const now = ctx.env.now();
    for (const line of table(
      [{ header: '' }, { header: 'ID' }, { header: 'TITLE' }, { header: 'STATUS' }],
      posts.map((post) => [
        statusGlyph(post, ctx.theme, now),
        ctx.theme.muted(String(post.id)),
        post.title,
        post.is_public === false
          ? `${postStatus(post, now)} ${ctx.theme.muted('· private')}`
          : postStatus(post, now),
      ]),
      ctx.theme,
    )) {
      ctx.out(line);
    }

    ctx.say('');
    ctx.say(ctx.theme.muted(plural(posts.length, 'post')));
  },
});

const renderPost = (ctx: RunContext, post: Post, verbose: boolean): string[] => {
  const now = ctx.env.now();
  const rows = [
    { term: 'id', description: ctx.theme.muted(String(post.id)) },
    { term: 'title', description: post.title },
    { term: 'status', description: postStatus(post, now) + (post.is_public === false ? ' (private)' : '') },
  ];

  if (post.published_at != null) {
    rows.push({
      term: isScheduled(post, now) ? 'goes live' : 'published',
      description: new Date(post.published_at).toLocaleString(),
    });
  }
  if (verbose) {
    if (post.summary) rows.push({ term: 'summary', description: post.summary });
    if (post.override_url) rows.push({ term: 'url', description: ctx.theme.url(post.override_url) });
    if (post.category?.name) rows.push({ term: 'category', description: post.category.name });
    if (post.portal_url) rows.push({ term: 'portal', description: ctx.theme.url(post.portal_url) });
  }

  return definitionList(rows, ctx.theme);
};

export const getCommand = defineCommand({
  name: 'get',
  summary: 'show one post in full',
  args: [{ name: 'id', summary: 'the post to show', required: true }],

  async run(ctx) {
    const id = ctx.args[0] ?? '';
    const session = await openSession(ctx, { require: true });
    const post = await session.http.get<Post>(`/api/v1/posts/${encodeURIComponent(id)}`);

    ctx.emit({ ok: true, post });
    if (ctx.globals.json) return;

    for (const line of renderPost(ctx, post, true)) ctx.out(line);
    ctx.out('');
    ctx.out(post.content ?? ctx.theme.muted('(empty)'));
  },
});

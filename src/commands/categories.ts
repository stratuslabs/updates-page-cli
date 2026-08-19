/**
 * Category management.
 *
 * `updates categories` with no subcommand still lists, as it did in v1 —
 * `defaultSubcommand` preserves that after `list` became explicit.
 */

import { defineCommand } from '../kit/command.ts';
import { UsageError } from '../kit/errors.ts';
import { plural, table } from '../kit/render.ts';
import type { Category } from './posts-api.ts';
import { openSession } from './session.ts';

const listCommand = defineCommand({
  name: 'list',
  summary: 'list all categories',

  async run(ctx) {
    const session = await openSession(ctx, { require: true });
    const categories = await session.http.get<Category[]>('/api/v1/categories');

    ctx.emit({ ok: true, categories });
    if (ctx.globals.json) return;

    if (!Array.isArray(categories) || categories.length === 0) {
      ctx.say(ctx.theme.muted('No categories found.'));
      return;
    }

    for (const line of table(
      [{ header: 'ID' }, { header: 'NAME' }, { header: 'COLOUR' }],
      categories.map((category) => [
        ctx.theme.muted(String(category.id)),
        category.name,
        category.color ?? ctx.theme.muted('-'),
      ]),
      ctx.theme,
    )) {
      ctx.out(line);
    }

    ctx.say('');
    ctx.say(ctx.theme.muted(plural(categories.length, 'category', 'categories')));
  },
});

const createCommand = defineCommand({
  name: 'create',
  summary: 'create a category',
  flags: {
    name: { type: 'string', placeholder: '<name>', summary: 'category name', required: true },
    color: { type: 'string', placeholder: '<hex>', summary: 'display colour, e.g. #8B5CF6' },
  },
  examples: [{ cmd: 'categories create --name Fixes --color "#8B5CF6"', note: 'add one' }],

  async run(ctx) {
    const session = await openSession(ctx, { require: true });
    const color = ctx.flags.string('color');
    const category = await session.http.post<Category>('/api/v1/categories', {
      body: { category: { name: ctx.flags.requireString('name'), ...(color === undefined ? {} : { color }) } },
    });

    ctx.emit({ ok: true, category });
    if (ctx.globals.json) return;

    ctx.say(ctx.theme.ok('Category created'));
    ctx.out(`  ID: ${category.id}`);
    ctx.out(`  Name: ${category.name}`);
    if (category.color) ctx.out(`  Colour: ${category.color}`);
  },
});

const updateCommand = defineCommand({
  name: 'update',
  summary: 'rename or recolour a category',
  args: [{ name: 'id', summary: 'the category to change', required: true }],
  flags: {
    name: { type: 'string', placeholder: '<name>', summary: 'new name' },
    color: { type: 'string', placeholder: '<hex>', summary: 'new display colour' },
  },

  async run(ctx) {
    const name = ctx.flags.string('name');
    const color = ctx.flags.string('color');

    if (name === undefined && color === undefined) {
      throw new UsageError('Nothing to update.', { hint: 'Pass --name and/or --color.' });
    }

    const session = await openSession(ctx, { require: true });
    const category = await session.http.put<Category>(
      `/api/v1/categories/${encodeURIComponent(ctx.args[0] ?? '')}`,
      { body: { category: { ...(name === undefined ? {} : { name }), ...(color === undefined ? {} : { color }) } } },
    );

    ctx.emit({ ok: true, category });
    if (ctx.globals.json) return;

    ctx.say(ctx.theme.ok('Category updated'));
    ctx.out(`  ID: ${category.id}`);
    ctx.out(`  Name: ${category.name}`);
    if (category.color) ctx.out(`  Colour: ${category.color}`);
  },
});

const deleteCommand = defineCommand({
  name: 'delete',
  summary: 'delete a category',
  args: [{ name: 'id', summary: 'the category to delete', required: true }],

  async run(ctx) {
    const id = ctx.args[0] ?? '';
    const session = await openSession(ctx, { require: true });
    await session.http.delete(`/api/v1/categories/${encodeURIComponent(id)}`);

    ctx.emit({ ok: true, id });
    if (ctx.globals.json) return;

    ctx.say(ctx.theme.ok('Category deleted'));
    ctx.out(`  ID: ${id}`);
  },
});

export const categoriesCommand = defineCommand({
  name: 'categories',
  summary: 'manage categories',
  // Bare `updates categories` listed in v1, and must keep doing so.
  defaultSubcommand: 'list',
  subcommands: [listCommand, createCommand, updateCommand, deleteCommand],
});

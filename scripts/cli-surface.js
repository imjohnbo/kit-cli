#!/usr/bin/env node
/**
 * The CLI's public surface, captured so a release can tell a breaking change
 * from an additive one.
 *
 * A semver rule is only enforceable if a machine can see what changed. For a
 * library that means exported symbols. For a CLI it means the command tree: the
 * commands, their arguments, and their flags. Removing or renaming any of those
 * breaks a caller's script. Adding one does not.
 *
 * spec/cli-surface.json holds the committed snapshot. A test asserts it matches
 * the current tree, so any surface change has to be committed on purpose and
 * shows up in review. The release gate compares the snapshot at the previous tag
 * with the one being released and refuses to ship a breaking change under a
 * patch bump.
 *
 * Run `npm run surface` to regenerate the snapshot.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProgram } from '../src/program.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SURFACE_PATH = join(__dirname, '..', 'spec', 'cli-surface.json');

/**
 * Walks a commander tree into a flat map of command path to its signature.
 *
 * Descriptions and help text are left out. They are not a contract, and
 * including them would flag every wording change as a surface change.
 */
export function captureSurface(program = buildProgram()) {
  const commands = {};

  const walk = (cmd, prefix = []) => {
    for (const child of cmd.commands) {
      if (child.name() === 'help') continue;
      const path = [...prefix, child.name()];

      commands[path.join(' ')] = {
        arguments: (child.registeredArguments ?? []).map((a) => ({
          name: a.name(),
          required: Boolean(a.required),
          variadic: Boolean(a.variadic),
        })),
        options: child.options
          .map((o) => o.long)
          .filter(Boolean)
          .filter((l) => l !== '--help')
          .sort(),
      };

      walk(child, path);
    }
  };

  walk(program);
  return { commands };
}

/** Reads the committed snapshot, or null when there is not one. */
export function readSurface(path = SURFACE_PATH) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Writes the snapshot, formatted so a diff reads cleanly. */
export function writeSurface(surface, path = SURFACE_PATH) {
  writeFileSync(path, JSON.stringify(surface, null, 2) + '\n');
}

/**
 * Compares two surfaces.
 *
 * `breaking` holds changes that can break an existing invocation.
 * `additive` holds changes that cannot.
 */
export function diffSurface(before, after) {
  const breaking = [];
  const additive = [];

  const oldCmds = before?.commands ?? {};
  const newCmds = after?.commands ?? {};

  for (const path of Object.keys(oldCmds)) {
    if (!(path in newCmds)) {
      breaking.push(`removed command: kit ${path}`);
      continue;
    }

    const o = oldCmds[path];
    const n = newCmds[path];

    for (const opt of o.options) {
      if (!n.options.includes(opt)) breaking.push(`removed flag: kit ${path} ${opt}`);
    }
    for (const opt of n.options) {
      if (!o.options.includes(opt)) additive.push(`new flag: kit ${path} ${opt}`);
    }

    const oldArgs = o.arguments ?? [];
    const newArgs = n.arguments ?? [];

    if (newArgs.length < oldArgs.length) {
      breaking.push(`removed argument: kit ${path} <${oldArgs[oldArgs.length - 1]?.name}>`);
    }

    newArgs.forEach((arg, i) => {
      const prev = oldArgs[i];
      if (!prev) {
        // A new required argument breaks every existing invocation.
        if (arg.required) breaking.push(`new required argument: kit ${path} <${arg.name}>`);
        else additive.push(`new optional argument: kit ${path} [${arg.name}]`);
        return;
      }
      if (arg.required && !prev.required) {
        breaking.push(`argument became required: kit ${path} <${arg.name}>`);
      }
      if (prev.name !== arg.name) {
        additive.push(`argument renamed: kit ${path} ${prev.name} -> ${arg.name}`);
      }
    });
  }

  for (const path of Object.keys(newCmds)) {
    if (!(path in oldCmds)) additive.push(`new command: kit ${path}`);
  }

  return { breaking, additive };
}

/** 'breaking', 'additive', or 'none'. */
export function classifySurfaceDiff(diff) {
  if (diff.breaking.length > 0) return 'breaking';
  if (diff.additive.length > 0) return 'additive';
  return 'none';
}

// ── CLI ────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const surface = captureSurface();

  if (process.argv.includes('--write')) {
    writeSurface(surface);
    console.log(`Wrote ${Object.keys(surface.commands).length} commands to spec/cli-surface.json`);
  } else {
    console.log(JSON.stringify(surface, null, 2));
  }
}

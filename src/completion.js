/**
 * Computes shell-completion candidates for a partially-typed command line.
 *
 * `words` is every word typed after `kit` so far, with the last one being
 * the word currently being completed (an empty string right after a
 * trailing space). Walks the live command tree — the same one
 * scripts/cli-surface.js and src/telemetry-events.js walk — so completions
 * can never drift from the actual command surface; there's no separate list
 * to keep in sync.
 *
 * Only completes command/subcommand names and option flags, not argument
 * values (subscriber IDs, tag names, and so on have no fixed set to
 * complete against).
 */
export function complete(program, words) {
  const preceding = words.slice(0, -1);
  const partial = words[words.length - 1] || '';

  let node = program;
  for (const word of preceding) {
    const next = node.commands.find((c) => c.name() === word && c.name() !== 'help' && c.name() !== '__complete');
    if (!next) return []; // fell off the known command tree — nothing left to complete
    node = next;
  }

  const commandNames = node.commands
    .map((c) => c.name())
    .filter((name) => name !== 'help' && name !== '__complete' && name.startsWith(partial));

  if (partial.startsWith('-')) {
    const flags = node.options.map((o) => o.long).filter(Boolean).filter((f) => f.startsWith(partial));
    return [...commandNames, ...flags];
  }

  return commandNames;
}

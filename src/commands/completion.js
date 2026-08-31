import { Command } from 'commander';
import { complete } from '../completion.js';
import { withErrorHandler } from '../output.js';

const BASH_SCRIPT = `_kit_completion() {
  local words
  words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  COMPREPLY=($(kit __complete "\${words[@]}"))
}
complete -F _kit_completion kit
`;

const ZSH_SCRIPT = `#compdef kit
_kit_completion() {
  local -a completions
  completions=("\${(@f)$(kit __complete "\${words[@]:1}")}")
  compadd -a completions
}
compdef _kit_completion kit
`;

const FISH_SCRIPT = `function __kit_complete
  set -l words (commandline -opc)
  kit __complete $words[2..-1] (commandline -ct)
end
complete -c kit -f -a '(__kit_complete)'
`;

const SCRIPTS = { bash: BASH_SCRIPT, zsh: ZSH_SCRIPT, fish: FISH_SCRIPT };

export function completionCommand() {
  const cmd = new Command('completion')
    .description('Print a shell completion script (bash, zsh, or fish) — add `eval "$(kit completion zsh)"` to your shell rc file')
    .argument('<shell>', 'bash, zsh, or fish');

  cmd.action(
    withErrorHandler(async (shell) => {
      const script = SCRIPTS[shell];
      if (!script) {
        throw new Error(`Unsupported shell: "${shell}". Must be one of: bash, zsh, fish.`);
      }
      console.log(script);
    })
  );

  return cmd;
}

/**
 * The hidden completion backend, invoked by the shell on every tab press.
 * Deliberately not wrapped in withErrorHandler: that would fire a telemetry
 * event on every keystroke a user tab-completes, which is noise, not
 * signal — see the NO_EVENT entry for '__complete' in telemetry-events.js.
 */
export function completeCommand(program) {
  const cmd = new Command('__complete')
    .description('Internal: computes shell completions')
    .argument('[words...]', 'words typed so far');

  cmd.action((words) => {
    for (const candidate of complete(program, words)) {
      console.log(candidate);
    }
  });

  return cmd;
}

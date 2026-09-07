#!/usr/bin/env node
/**
 * ============================================================================
 *  GIT WRITE GUARD
 * ============================================================================
 *  A `beforeShellExecution` hook that stops the agent from running git
 *  commands that change anything. Reading history, diffs and status stays
 *  free; committing, pushing, resetting, rebasing and friends are blocked and
 *  handed back to you.
 *
 *  WHY IT IS AN ALLOWLIST, NOT A BLOCKLIST
 *  A blocklist fails silently in the dangerous direction: the day it misses a
 *  subcommand, something gets rewritten and nobody finds out until later. Here
 *  anything not positively recognised as read-only is denied, so the failure
 *  mode is an unnecessary "ask Matan to run it", which is merely mildly
 *  annoying and immediately visible.
 *
 *  Written in Node rather than bash because Node is guaranteed present in this
 *  project, needs no `jq`, and behaves the same on Windows and Linux.
 * ============================================================================
 */

/**
 * 'deny' — block outright; you run the command yourself.
 * 'ask'  — prompt you for approval instead, which is one click rather than a
 *          copy-paste if you would rather keep the agent doing the typing.
 */
const MODE = 'deny';

/** Subcommands that cannot change a repository. */
const READ_ONLY = new Set([
  'annotate', 'blame', 'bugreport', 'cat-file', 'check-attr', 'check-ignore',
  'check-mailmap', 'check-ref-format', 'cherry', 'count-objects', 'describe',
  'diff', 'diff-files', 'diff-index', 'diff-tree', 'difftool', 'fetch',
  'for-each-ref', 'fsck', 'grep', 'help', 'log', 'ls-files', 'ls-remote',
  'ls-tree', 'merge-base', 'merge-tree', 'name-rev', 'patch-id', 'range-diff',
  'rev-list', 'rev-parse', 'shortlog', 'show', 'show-branch', 'show-index',
  'show-ref', 'status', 'var', 'verify-commit', 'verify-pack', 'verify-tag',
  'version', 'whatchanged',
]);

/**
 * Subcommands that read or write depending on their arguments. Each returns
 * true only when the specific invocation is provably read-only.
 */
const CONDITIONAL = {
  // `git branch` lists; `git branch <name>` creates and `-d` deletes. Any
  // positional argument is therefore treated as a write.
  branch: (args) => args.every((a) => a.startsWith('-') && SAFE_BRANCH_FLAGS.has(flagName(a))),
  tag: (args) => args.every((a) => a.startsWith('-') && SAFE_TAG_FLAGS.has(flagName(a))),
  remote: (args) => args.length === 0 || ['-v', '--verbose', 'show', 'get-url'].includes(args[0]),
  config: (args) => args.some((a) => ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(flagName(a))),
  stash: (args) => ['list', 'show'].includes(args[0]),
  submodule: (args) => ['status', 'summary'].includes(args[0]),
  worktree: (args) => args[0] === 'list',
  notes: (args) => ['list', 'show'].includes(args[0]),
  bisect: (args) => ['log', 'view'].includes(args[0]),
  // Bare `git reflog` defaults to `show`; `expire` and `delete` destroy it.
  reflog: (args) => args.length === 0 || args[0] === 'show',
};

const SAFE_BRANCH_FLAGS = new Set([
  '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '-l', '--list',
  '--show-current', '--merged', '--no-merged', '--contains', '--no-contains',
  '--sort', '--format', '--points-at', '-q', '--quiet', '--color', '--no-color',
]);

const SAFE_TAG_FLAGS = new Set([
  '-l', '--list', '-n', '--contains', '--no-contains', '--sort', '--format',
  '--points-at', '--merged', '--no-merged',
]);

/** Commands that can precede git without changing what is being run. */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'time', 'nohup', 'command', 'exec', 'xargs']);

/**
 * Global options that sit before the subcommand. The ones listed here consume
 * the following token, which would otherwise be mistaken for the subcommand:
 * in `git -C /repo push`, the subcommand is push, not /repo.
 */
const VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);

function flagName(arg) {
  const eq = arg.indexOf('=');
  return eq === -1 ? arg : arg.slice(0, eq);
}

/** Splits a command line on shell separators, ignoring those inside quotes. */
function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') {
      if ((ch === '|' || ch === '&') && command[i + 1] === ch) i++;
      segments.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  segments.push(current);
  return segments.filter((segment) => segment.trim() !== '');
}

function tokenize(segment) {
  const tokens = [];
  let current = '';
  let quote = null;

  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

/** Strips shell punctuation so `$(git` and `` `git `` are recognised. */
function normalize(token) {
  return token.replace(/^[$(`'"]+/, '').replace(/['")`]+$/, '');
}

function isGitExecutable(token) {
  const bare = normalize(token).toLowerCase().replace(/\\/g, '/');
  return bare === 'git' || bare.endsWith('/git') || bare === 'git.exe' || bare.endsWith('/git.exe');
}

/**
 * Finds every git invocation in a segment and returns its arguments.
 *
 * Only the head of the segment, a token inside a substitution, or a token
 * directly after a wrapper counts. Without that restriction `grep git README`
 * would be read as a git command and denied.
 */
function findInvocations(tokens) {
  const invocations = [];

  for (let i = 0; i < tokens.length; i++) {
    if (!isGitExecutable(tokens[i])) continue;

    const substitution = /^[$(`]/.test(tokens[i]);
    const afterWrapper = i > 0 && WRAPPERS.has(normalize(tokens[i - 1]).toLowerCase());
    if (i !== 0 && !substitution && !afterWrapper) continue;

    invocations.push(tokens.slice(i + 1).map(normalize));
  }

  return invocations;
}

/** Skips global options to find the subcommand and the arguments after it. */
function parseSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (VALUE_OPTIONS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith('-')) continue;

    return { name: arg.toLowerCase(), rest: args.slice(i + 1) };
  }

  return { name: null, rest: [] };
}

/** @returns {string|null} the reason to block, or null to allow. */
function inspect(command) {
  for (const segment of splitSegments(command)) {
    for (const args of findInvocations(tokenize(segment))) {
      // `--dry-run` makes even a push harmless, and is genuinely useful for
      // showing you what a command would do before you run it yourself.
      if (args.includes('--dry-run')) continue;

      const { name, rest } = parseSubcommand(args);

      // Bare `git`, `git --version`, `git --help`.
      if (name === null) continue;
      if (READ_ONLY.has(name)) continue;

      const check = CONDITIONAL[name];
      if (check && check(rest)) continue;

      return `git ${name}`;
    }
  }

  return null;
}

function refuse(reason, detail) {
  return {
    permission: MODE === 'ask' ? 'ask' : 'deny',
    user_message: `Blocked: ${reason}`,
    agent_message: detail,
  };
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();

  // Input we cannot read is treated as a command we cannot clear. Only
  // git-ish commands are routed here by the matcher, so the cost of being
  // wrong is a spurious block, which is loud and harmless — whereas allowing
  // an unreadable payload would be a silent hole straight through the guard.
  if (raw === '') return refuse('the git guard received no command to inspect.', 'The git write guard got empty input and cannot verify what was about to run.');

  let command;
  try {
    command = JSON.parse(raw).command;
  } catch {
    return refuse(
      'the git guard could not parse the command.',
      'The git write guard received input it could not parse, so it blocked the command rather than guess. Report this instead of retrying.',
    );
  }

  if (typeof command !== 'string') {
    return refuse(
      'the git guard saw no command string.',
      'The git write guard found no command field to inspect, so it blocked rather than guess.',
    );
  }

  const blocked = inspect(command);
  if (!blocked) return { permission: 'allow' };

  return refuse(
    `\`${blocked}\`. This repo's hook only lets the agent run read-only git.`,
    [
      `The git write guard blocked \`${blocked}\`.`,
      '',
      'This project only allows you to run git commands that cannot change the',
      'repository — status, log, diff, show and similar are all fine.',
      '',
      'Do not try to work around this by rephrasing the command or by reaching',
      'for another tool. Tell Matan the exact command you wanted to run and why,',
      'and let him run it. If he wants to lift the restriction, the switch is',
      "MODE in .cursor/hooks/guard-git.js, or he can delete the hook entry.",
    ].join('\n'),
  );
}

main()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  })
  .catch((error) => {
    // failClosed is on, so a crash here blocks rather than waving things
    // through. Say so clearly instead of failing mysteriously.
    process.stdout.write(
      JSON.stringify({
        permission: 'deny',
        user_message: 'The git guard hook itself failed, so the command was blocked.',
        agent_message: `The git write guard crashed: ${error?.message ?? error}. Report this rather than retrying.`,
      }),
    );
    process.exit(0);
  });

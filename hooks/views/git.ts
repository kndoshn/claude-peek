// The Git view: the repository's status and history, and a commit opened from the history, read
// again while shown. Diffs of the work in progress are the built-in /diff's.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { GitState, Location } from '../../types'
import { where } from '../find'
import type { Messages } from '../messages'
import { logLineText, parseLog, parseStatus, splitPatch } from '../pure/git'
import { locate } from '../pure/quote'
import type { Opened } from './file'

type Api = EngineInterface

// How many commits the history shows.
const LOG_COUNT = 40
// How often Git is read again while shown.
const REREAD_MS = 5000
// git without taking the index lock, which a git of Claude's may be holding.
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0' }

// Read and written only in this file (see views/file.ts).
const git = atom({ plugin: 'peek', key: 'git' } as const, null, { shape: 'git-1' })

// When Git was last read, whether something may have changed it since, and whether a read is
// under way.
let readAt: number | undefined
let isStale = false
let reading = false

// Forgets what an earlier load of the module was doing.
export function resetGit(): void {
  readAt = undefined
  isStale = false
  reading = false
}

// Something may have changed the repository (a turn ended, Claude ran a command or edited a file).
export function markGitStale(): void {
  isStale = true
}

// Git as shown, for a drawing, which a change to it then redraws.
export async function shownGit($: Api): Promise<GitState | null> {
  return read($, git)
}

async function run($: Api, argv: string[], cwd: string): Promise<string | undefined> {
  const result = await $.process.run(argv, { cwd, env: GIT_ENV }).catch(() => undefined)
  return result?.exitCode === 0 ? result.stdout : undefined
}

// A commit's details, its changes by file in numbers, and its diff by file (a merge's against its
// first parent).
async function readCommit($: Api, root: string, hash: string): Promise<GitState['commit'] | undefined> {
  const head = await run($, ['git', 'show', '-s', '--format=%h%x1f%an%x1f%ad%x1f%s%x1f%b', '--date=format:%Y-%m-%d %H:%M', hash], root)
  if (head === undefined) return undefined
  const [short = hash, author = '', date = '', subject = '', body = ''] = head.replace(/\n+$/, '').split('\u001f')
  const stat = (await run($, ['git', 'show', '--format=', '--stat=120', '--no-color', '--diff-merges=first-parent', hash], root)) ?? ''
  const patch =
    (await run($, ['git', 'show', '--format=', '--patch', '--no-color', '--no-ext-diff', '--diff-merges=first-parent', hash], root)) ?? ''
  return { hash: short, author, date, subject, body: body.trim(), stat, files: splitPatch(patch) }
}

// Reads the repository the working directory is in: its status and history, and `commit`'s
// details when given.
export async function loadGit($: Api, say: Messages, commit?: string): Promise<Opened> {
  const at = await where($)
  const root = (await run($, ['git', 'rev-parse', '--show-toplevel'], at.cwd))?.trim()
  if (!root) return { error: say.notRepo }
  const status = await run($, ['git', 'status', '--porcelain=v2', '--branch', '--show-stash', '-z', '--untracked-files=normal'], root)
  if (status === undefined) return { error: say.notRepo }
  const log = await run($, ['git', 'log', '--graph', '--format=%x1f%h%x1f%D%x1f%s%x1f%ar', '-n', String(LOG_COUNT), '--color=never'], root)
  const details = commit ? await readCommit($, root, commit) : undefined
  if (commit && !details) return { error: say.noCommit(commit) }
  const home = at.home
  const state: GitState = {
    root,
    label: home && root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root,
    status: parseStatus(status),
    log: log === undefined ? [] : parseLog(log),
    ...(details ? { commit: details } : {}),
  }
  await update($, git, () => state)
  readAt = await $.clock.now().catch(() => undefined)
  isStale = false
  const s = state.status
  const lines = details
    ? details.stat.split('\n').length + details.files.reduce((sum, file) => sum + file.hunks.split('\n').length + 1, 0)
    : s.staged.length + s.unstaged.length + s.untracked.length + state.log.length + 8
  return { title: 'git', label: details ? details.hash : say.views.git, rows: lines + 2 }
}

// Reads Git again, the commit opened kept open.
export async function refreshGit($: Api, say: Messages): Promise<void> {
  if (reading) return
  reading = true
  try {
    const shown = await read($, git)
    if (shown) await loadGit($, say, shown.commit?.hash)
  } finally {
    reading = false
  }
}

// Reads Git again when it is due: something may have changed it, or REREAD_MS passed.
export async function tickGit($: Api, say: Messages): Promise<void> {
  const now = await $.clock.now().catch(() => undefined)
  if (isStale || readAt === undefined || (now !== undefined && now - readAt >= REREAD_MS)) await refreshGit($, say)
}

// Where the Git view is, for Back.
export async function gitLocation($: Api): Promise<Location | undefined> {
  const shown = await read($, git)
  if (!shown) return undefined
  return { view: 'git', ...(shown.commit ? { commit: shown.commit.hash } : {}) }
}

// The status as text, a line a file, as the view draws it.
function statusText(shown: GitState): string {
  const s = shown.status
  return [...s.staged.map(f => `${f.mark} ${f.path}`), ...s.unstaged.map(f => `${f.mark} ${f.path}`), ...s.untracked.map(path => `? ${path}`)].join('\n')
}

// The commit opened as text: its subject, details, numbers and diff.
function commitText(commit: NonNullable<GitState['commit']>): string {
  return [
    `${commit.hash} ${commit.subject}`,
    `${commit.author} · ${commit.date}`,
    commit.body,
    commit.stat,
    ...commit.files.flatMap(file => [file.path, file.hunks || file.note]),
  ].join('\n')
}

// A selection from the Git view, headed by what it came from: the commit opened, the status or the
// history; undefined when it is in none.
export async function gitQuote($: Api, selected: string): Promise<{ head: string; text: string } | undefined> {
  const shown = await read($, git)
  if (!shown) return undefined
  if (shown.commit) return locate(commitText(shown.commit), selected) ? { head: `git show ${shown.commit.hash}`, text: selected } : undefined
  if (locate(statusText(shown), selected)) return { head: 'git status', text: selected }
  if (locate(shown.log.map(logLineText).join('\n'), selected)) return { head: 'git log', text: selected }
  return undefined
}

// The commit opened, as Claude can look it up: its hash and subject.
export async function gitMention($: Api): Promise<string | undefined> {
  const commit = (await read($, git))?.commit
  return commit ? `${commit.hash} (${commit.subject})` : undefined
}

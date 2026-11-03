// The Git view: the repository's status and history, and a commit opened from the history, read
// again while shown. Diffs of the work in progress are the built-in /diff's.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CommitDetails, GitState, Location } from '../../types'
import { where } from '../find'
import type { Messages } from '../messages'
import type { Opened } from '../nav'
import { logLineText, parseLog, parseStatus, splitPatch } from '../pure/git'
import { fromHome } from '../pure/paths'
import { locate, shellWord } from '../pure/quote'
import type { Quoted } from '../pure/quote'
import { now, rereads, runGit } from '../run'

type Api = EngineInterface

// How many commits the history shows.
const LOG_COUNT = 40
const STATUS = ['status', '--porcelain=v2', '--branch', '--show-stash', '-z', '--untracked-files=normal']
const LOG = ['log', '--graph', '--format=%x1f%h%x1f%D%x1f%s%x1f%ar', '-n', String(LOG_COUNT), '--color=never']

// Read and written only in this file (see views/file.ts).
const git = atom({ plugin: 'peek', key: 'git' } as const, null, { shape: 'git-1' })

// Git is checked every 5 seconds while shown, and read again when it moved.
const schedule = rereads(5000)
// The status the last read found, which tells on a timer whether anything moved.
let lastStatus: string | undefined

// Forgets what an earlier load of the module was doing.
export function resetGit(): void {
  schedule.reset()
  lastStatus = undefined
}

// Something may have changed the repository (a turn ended, Claude ran a command or edited a file).
export function markGitStale(): void {
  schedule.markStale()
}

// Git as shown, for a drawing, which a change to it then redraws.
export async function shownGit($: Api): Promise<GitState | null> {
  return read($, git)
}

// A commit's details, its changes by file in numbers, and its diff by file (a merge's against its
// first parent), read from `cwd` in its repository.
async function readCommit($: Api, cwd: string, hash: string): Promise<CommitDetails | undefined> {
  const [head, stat = '', patch = ''] = await Promise.all([
    runGit($, ['show', '-s', '--format=%h%x1f%an%x1f%ad%x1f%s%x1f%b', '--date=format:%Y-%m-%d %H:%M', hash], cwd),
    runGit($, ['show', '--format=', '--stat=120', '--no-color', '--diff-merges=first-parent', hash], cwd),
    runGit($, ['show', '--format=', '--patch', '--no-color', '--no-ext-diff', '--diff-merges=first-parent', hash], cwd),
  ])
  if (head === undefined) return undefined
  const [short = hash, author = '', date = '', subject = '', body = ''] = head.replace(/\n+$/, '').split('\u001f')
  return { hash: short, author, date, subject, body: body.trim(), stat, files: splitPatch(patch) }
}

// Reads the repository the working directory is in: its top folder, status and history, and
// `commit`'s details when given, side by side, as git answers from anywhere in the repository
// with paths from its top. A commit already shown is kept, as a commit never changes; what reads
// as it was shown is not written, so the pane is not drawn again for nothing.
export async function loadGit($: Api, say: Messages, commit?: string): Promise<Opened> {
  const at = await where($)
  const current = await read($, git)
  const held = commit && current?.commit?.hash === commit ? current.commit : undefined
  const [top, status, log, details] = await Promise.all([
    runGit($, ['rev-parse', '--show-toplevel'], at.cwd),
    runGit($, STATUS, at.cwd),
    runGit($, LOG, at.cwd),
    held ?? (commit ? readCommit($, at.cwd, commit) : undefined),
  ])
  const root = top?.trim()
  if (!root || status === undefined) return { error: say.notRepo }
  if (commit && !details) return { error: say.noCommit(commit) }
  const state: GitState = {
    root,
    label: fromHome(at.home, root),
    status: parseStatus(status),
    log: log === undefined ? [] : parseLog(log),
    ...(details ? { commit: details } : {}),
  }
  if (JSON.stringify(state) !== JSON.stringify(current)) await update($, git, () => state)
  schedule.done(await now($))
  lastStatus = status
  const s = state.status
  const lines = details
    ? details.stat.split('\n').length + details.files.reduce((sum, file) => sum + file.hunks.split('\n').length + 1, 0)
    : s.staged.length + s.unstaged.length + s.untracked.length + state.log.length + 8
  return { title: 'git', label: details ? details.hash : say.views.git, lines }
}

// Reads Git again in full, the commit opened kept open.
async function reload($: Api, say: Messages): Promise<void> {
  const shown = await read($, git)
  if (shown) await loadGit($, say, shown.commit?.hash)
}

// Reads Git again at once (the Refresh button).
export async function refreshGit($: Api, say: Messages): Promise<void> {
  await schedule.run(() => reload($, say))
}

// Reads Git again when it is due: in full when something may have changed it; else its status,
// and the rest only when the status moved.
export async function tickGit($: Api, say: Messages): Promise<void> {
  const moved = async () => {
    const shown = await read($, git)
    return shown !== null && (lastStatus === undefined || (await runGit($, STATUS, shown.root)) !== lastStatus)
  }
  await schedule.tick(await now($), moved, () => reload($, say))
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

// The commit opened as text, as the view draws it: its subject, details and numbers, then each
// file's name and diff.
function commitParts(commit: CommitDetails): { preamble: string; files: { path: string; text: string }[] } {
  return {
    preamble: [`${commit.hash} ${commit.subject}`, `${commit.author} · ${commit.date}`, commit.body, commit.stat].join('\n'),
    files: commit.files.map(file => ({ path: file.path, text: `${file.path}\n${file.hunks || file.note}` })),
  }
}

// A selection from the commit opened, headed by the commit, and by the file too when the
// selection is in that file's diff alone; undefined when it is not in the commit.
function commitQuote(commit: CommitDetails, selected: string): Quoted | undefined {
  const { preamble, files } = commitParts(commit)
  if (!locate([preamble, ...files.map(file => file.text)].join('\n'), selected)) return undefined
  const head = `git show ${commit.hash}`
  const holding = files.filter(file => locate(file.text, selected))
  const only = holding.length === 1 && !locate(preamble, selected) ? holding[0] : undefined
  return { head: only ? `${head} -- ${shellWord(only.path)}` : head, text: selected }
}

// A selection from the Git view, headed by what it came from: the commit opened, the status or the
// history; undefined when it is in none.
export async function gitQuote($: Api, selected: string): Promise<Quoted | undefined> {
  const shown = await read($, git)
  if (!shown) return undefined
  if (shown.commit) return commitQuote(shown.commit, selected)
  if (locate(statusText(shown), selected)) return { head: 'git status', text: selected }
  if (locate(shown.log.map(logLineText).join('\n'), selected)) return { head: 'git log', text: selected }
  return undefined
}

// The commit opened, as Claude can look it up: its hash and subject.
export async function gitMention($: Api): Promise<string | undefined> {
  const commit = (await read($, git))?.commit
  return commit ? `${commit.hash} (${commit.subject})` : undefined
}

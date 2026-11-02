// Finding files: those the conversation named and the project's, what a /peek or /md argument
// means, and reading a file with its modification time.

import type { EngineInterface, SessionMessage } from 'claude-code'

import { absolute, closest, describe, MARKDOWN, named } from './pure/paths'
import type { Where } from './pure/paths'
import { now, runGit } from './run'

type Api = EngineInterface

// What a command looks for: a place (any file, a folder of the project, or a repository of
// ghq) for /peek, or a Markdown file for /md.
export type Kind = 'place' | 'markdown'

// How far back the commands and the completion look in the conversation.
const RECENT_MESSAGES = 30
// How long completion reuses what it listed, so typing does not list it again per key.
const LIST_TTL_MS = 5000
// The largest file read: what one read of the engine copies at most.
const MAX_READ_BYTES = 4 * 1024 * 1024

const accepts = (kind: Kind, path: string) => kind === 'place' || MARKDOWN.test(path)

export async function where($: Api): Promise<Where> {
  return { cwd: await $.session.cwd(), home: await $.env.get('HOME') }
}

export async function recentMessages($: Api): Promise<SessionMessage[]> {
  const messages = await $.session.messages()
  return Array.isArray(messages) ? messages.slice(-RECENT_MESSAGES) : []
}

// The messages since the person's last prompt: a user message that carries no tool results.
export function sinceLastPrompt(messages: readonly SessionMessage[]): readonly SessionMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role === 'user' && !message.toolResults?.length) return messages.slice(i + 1)
  }
  return messages
}

// The existing files of `kind` the replies among `messages` named, newest first, each once.
export async function existing($: Api, at: Where, messages: readonly SessionMessage[], kind: Kind): Promise<string[]> {
  const paths = [
    ...new Set(
      [...messages]
        .reverse()
        .filter(message => message.role === 'assistant')
        .flatMap(named)
        .filter(path => accepts(kind, path))
        .map(path => absolute(at, path)),
    ),
  ]
  const found = await Promise.all(paths.map(path => isFile($, path)))
  return paths.filter((_, i) => found[i])
}

type Listing = { named: string[]; files: string[]; repos: string[] }

// What completion last listed, reused for LIST_TTL_MS.
let listed: (Listing & { cwd: string; at: number }) | undefined

// Forgets what an earlier load of the module listed.
export function resetFind(): void {
  listed = undefined
}

// The project's files relative to the working directory: git's list (untracked ones too, ignored
// ones not), else fd's outside a repository, else none.
async function projectFiles($: Api, cwd: string): Promise<string[]> {
  const git = await runGit($, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd)
  if (git !== undefined) return git.split('\0').filter(Boolean)
  const fd = await $.process.run(['fd', '--type', 'f', '--hidden', '--exclude', '.git'], { cwd }).catch(() => undefined)
  return fd?.exitCode === 0 ? fd.stdout.split('\n').filter(Boolean) : []
}

// The repositories of ghq, absolute, or none without ghq.
async function ghqRepos($: Api): Promise<string[]> {
  const ghq = await $.process.run(['ghq', 'list', '-p']).catch(() => undefined)
  return ghq?.exitCode === 0 ? ghq.stdout.split('\n').filter(Boolean) : []
}

// The files the recent replies named that are there, the project's files and the repositories
// of ghq, read side by side. Unless `fresh`, a listing taken in the last few seconds is reused.
async function listings($: Api, at: Where, fresh: boolean): Promise<Listing> {
  const time = await now($)
  if (!fresh && listed?.cwd === at.cwd && time !== undefined && time - listed.at < LIST_TTL_MS) return listed
  const [named, files, repos] = await Promise.all([existing($, at, await recentMessages($), 'place'), projectFiles($, at.cwd), ghqRepos($)])
  if (time !== undefined) listed = { cwd: at.cwd, at: time, named, files, repos }
  return { named, files, repos }
}

// The folders the files are in, each with a closing slash.
function folders(files: readonly string[]): string[] {
  const found = new Set<string>()
  for (const file of files) {
    const parts = file.split('/')
    for (let depth = 1; depth < parts.length; depth += 1) found.add(`${parts.slice(0, depth).join('/')}/`)
  }
  return [...found]
}

// The labels to choose from: the files the conversation named, then the project's files; for a
// place also the project's folders and the repositories of ghq, each with a closing slash.
export async function candidates($: Api, at: Where, kind: Kind, fresh: boolean): Promise<string[]> {
  const { named, files, repos } = await listings($, at, fresh)
  const conversation = named.filter(path => accepts(kind, path)).map(path => describe(at, path).label)
  const places = kind === 'place' ? [...folders(files), ...repos.map(repo => `${describe(at, repo).label}/`)] : []
  return [...new Set([...conversation, ...files.filter(path => accepts(kind, path)), ...places])]
}

// The place `text` means: the path itself when it is there (a folder only for a place), else the
// best match of the candidates of `kind` for the words given.
export async function resolvePlace($: Api, at: Where, text: string, kind: Kind): Promise<{ path: string; isDir: boolean } | undefined> {
  const path = absolute(at, text)
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat?.kind === 'file') return { path, isDir: false }
  if (stat?.kind === 'dir' && kind === 'place') return { path, isDir: true }
  const best = closest(text, await candidates($, at, kind, true))
  if (best === undefined) return undefined
  return { path: absolute(at, best.replace(/\/$/, '')), isDir: best.endsWith('/') }
}

async function isFile($: Api, path: string): Promise<boolean> {
  try {
    return (await $.fs.stat(path)).kind === 'file'
  } catch {
    return false
  }
}

// The file's modification time, or undefined when it is not there.
export async function mtime($: Api, path: string): Promise<number | undefined> {
  try {
    const stat = await $.fs.stat(path)
    return stat.kind === 'file' ? stat.mtimeMs : undefined
  } catch {
    return undefined
  }
}

type Loaded = { text: string; mtimeMs: number } | { problem: 'unreadable' | 'binary' | 'large' }

// The file's text and modification time, or why it cannot be shown: missing or unreadable,
// binary (it holds a NUL), or over what one read takes.
export async function load($: Api, path: string): Promise<Loaded> {
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file') return { problem: 'unreadable' }
    if (stat.size > MAX_READ_BYTES) return { problem: 'large' }
    const text = await $.fs.read(path)
    if (typeof text !== 'string') return { problem: 'unreadable' }
    if (text.includes('\0')) return { problem: 'binary' }
    return { text, mtimeMs: stat.mtimeMs }
  } catch {
    return { problem: 'unreadable' }
  }
}

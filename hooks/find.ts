// Finding files: those the conversation named and the project's, what a /peek or /md argument
// means, and reading a file with its modification time.

import type { EngineInterface, SessionMessage } from 'claude-code'

import { absolute, describe, MARKDOWN, named, rank } from './pure/paths'
import type { Where } from './pure/paths'

type Api = EngineInterface

// Which files a command looks for: any file, or Markdown only (/md).
export type Kind = 'any' | 'markdown'

// How far back the commands and the completion look in the conversation.
const RECENT_MESSAGES = 30
// How long completion reuses the project's file list, so typing does not list it per key.
const LIST_TTL_MS = 5000
// The largest file read: what one read of the engine copies at most.
const MAX_READ_BYTES = 4 * 1024 * 1024

const accepts = (kind: Kind, path: string) => kind === 'any' || MARKDOWN.test(path)

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

// The project's file list completion last took, reused for LIST_TTL_MS.
let listed: { cwd: string; at: number; files: string[] } | undefined

// Forgets what an earlier load of the module listed.
export function resetFind(): void {
  listed = undefined
}

// The project's files relative to the working directory: git's list (untracked ones too,
// ignored ones not), else fd's outside a repository, else none. Unless `fresh`, a list taken in
// the last few seconds is reused.
async function projectFiles($: Api, cwd: string, fresh: boolean): Promise<string[]> {
  const now = await $.clock.now().catch(() => undefined)
  if (!fresh && listed?.cwd === cwd && now !== undefined && now - listed.at < LIST_TTL_MS) return listed.files
  const run = (argv: string[]) => $.process.run(argv).catch(() => undefined)
  const git = await run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  let files: string[] = []
  if (git?.exitCode === 0) files = git.stdout.split('\0').filter(Boolean)
  else {
    const fd = await run(['fd', '--type', 'f', '--hidden', '--exclude', '.git'])
    if (fd?.exitCode === 0) files = fd.stdout.split('\n').filter(Boolean)
  }
  if (now !== undefined) listed = { cwd, at: now, files }
  return files
}

// The labels of the files of `kind` to choose from: those the conversation named, then the
// project's.
export async function candidates($: Api, at: Where, kind: Kind, fresh: boolean): Promise<string[]> {
  const conversation = (await existing($, at, await recentMessages($), kind)).map(path => describe(at, path).label)
  const project = (await projectFiles($, at.cwd, fresh)).filter(path => accepts(kind, path))
  return [...new Set([...conversation, ...project])]
}

// The file `text` means: the path itself when it is a file, else the best match of the
// candidates of `kind` for the words given.
export async function resolveFile($: Api, at: Where, text: string, kind: Kind): Promise<string | undefined> {
  const path = absolute(at, text)
  if (await isFile($, path)) return path
  const [best] = rank(text, await candidates($, at, kind, true))
  return best === undefined ? undefined : absolute(at, best)
}

export async function isFile($: Api, path: string): Promise<boolean> {
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

export type Loaded = { text: string; mtimeMs: number } | { problem: 'unreadable' | 'binary' | 'large' }

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

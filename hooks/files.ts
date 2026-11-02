// Finding Markdown files: those the conversation named and the project's, what /md <arg>
// means, and reading a file with its modification time.

import type { EngineInterface, SessionMessage } from 'claude-code'

import { absolute, describe, named, rank } from './paths'
import type { Where } from './paths'

type Api = EngineInterface

// How far back /md without a path and the completion look.
const RECENT_MESSAGES = 30
// How long completion reuses the project's file list, so typing does not list it per key.
const LIST_TTL_MS = 5000

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

// The existing .md files the replies among `messages` named, newest first, each once.
export async function existing($: Api, at: Where, messages: readonly SessionMessage[]): Promise<string[]> {
  const paths = [
    ...new Set(
      [...messages]
        .reverse()
        .filter(message => message.role === 'assistant')
        .flatMap(named)
        .map(path => absolute(at, path)),
    ),
  ]
  const found = await Promise.all(paths.map(path => $.fs.exists(path).catch(() => false)))
  return paths.filter((_, i) => found[i])
}

// The project's file list completion last took, reused for LIST_TTL_MS.
let listed: { cwd: string; at: number; files: string[] } | undefined

// Forgets what an earlier load of the module listed.
export function resetFiles(): void {
  listed = undefined
}

// The project's Markdown files relative to the working directory: git's list (untracked ones
// too, ignored ones not), else fd's outside a repository, else none. Unless `fresh`, a list
// taken in the last few seconds is reused.
async function projectFiles($: Api, cwd: string, fresh: boolean): Promise<string[]> {
  const now = await $.clock.now().catch(() => undefined)
  if (!fresh && listed?.cwd === cwd && now !== undefined && now - listed.at < LIST_TTL_MS) return listed.files
  const run = (argv: string[]) => $.process.run(argv).catch(() => undefined)
  const git = await run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md', '*.markdown'])
  let files: string[] = []
  if (git?.exitCode === 0) files = git.stdout.split('\0').filter(Boolean)
  else {
    const fd = await run(['fd', '--type', 'f', '--extension', 'md', '--extension', 'markdown', '--hidden', '--exclude', '.git'])
    if (fd?.exitCode === 0) files = fd.stdout.split('\n').filter(Boolean)
  }
  if (now !== undefined) listed = { cwd, at: now, files }
  return files
}

// The labels of the .md files to choose from: those the conversation named, then the project's.
export async function candidates($: Api, at: Where, fresh: boolean): Promise<string[]> {
  const conversation = (await existing($, at, await recentMessages($))).map(path => describe(at, path).label)
  return [...new Set([...conversation, ...(await projectFiles($, at.cwd, fresh))])]
}

// The file /md <arg> means: the path itself when it exists, else the best match of the
// candidates for the words given.
export async function resolveArg($: Api, at: Where, arg: string): Promise<string | undefined> {
  const path = absolute(at, arg)
  if (await $.fs.exists(path)) return path
  const [best] = rank(arg, await candidates($, at, true))
  return best === undefined ? undefined : absolute(at, best)
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

export async function load($: Api, path: string): Promise<{ text: string; mtimeMs: number } | undefined> {
  try {
    const mtimeMs = (await mtime($, path)) ?? 0
    const text = await $.fs.read(path)
    return typeof text === 'string' ? { text, mtimeMs } : undefined
  } catch {
    return undefined
  }
}

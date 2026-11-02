import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, SessionMessage } from 'claude-code'

import type { MdFile } from '../types'
import { languageOf, MESSAGES } from './messages'
import type { Lang, Messages } from './messages'
import { basename, cite, locate, quote, rank } from './text'

// md-review: read a Markdown file rendered in a pane beside the chat and quote passages of it
// into the prompt, so a review needs no other tab, editor or browser.
//   /md [path]   opens the file: a path, part of a file name, or without one the newest .md
//                the conversation named; its argument completes to the conversation's and
//                the project's Markdown files
//   the band     above the prompt: quote the mouse selection headed by its file and lines,
//                reload, close, and an offer to open the .md the last reply named
//   the pane     follows the file: a change on disk, by Claude or anything else, redraws it

type Api = EngineInterface

const PANE = 'md-review'
const doc = atom({ plugin: 'md-review', key: 'doc' } as const, null, { shape: 'doc-3' })
const offer = atom({ plugin: 'md-review', key: 'offer' } as const, null, { shape: 'offer-1' })

const MARKDOWN = /\.(md|markdown)$/i
// A path ending in .md inside a reply, stopping at spaces, quotes, backticks and brackets.
const PATH_IN_TEXT = /[^\s`'"()<>[\]{}|,]+\.(?:md|markdown)(?![\w/])/gi
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'Read'])
// How far back /md without a path and the completion look.
const RECENT_MESSAGES = 30
const MAX_SUGGESTIONS = 10
// How often the open file is checked for changes on disk.
const WATCH_MS = 1000

async function home($: Api): Promise<string | undefined> {
  return $.env.get('HOME')
}

async function absolute($: Api, path: string): Promise<string> {
  if (path.startsWith('/')) return path
  if (path.startsWith('~/')) return `${(await home($)) ?? '~'}${path.slice(1)}`
  return `${await $.session.cwd()}/${path.replace(/^\.\//, '')}`
}

async function describe($: Api, path: string): Promise<MdFile> {
  const cwd = await $.session.cwd()
  const dir = await home($)
  if (path.startsWith(`${cwd}/`)) return { path, label: path.slice(cwd.length + 1) }
  if (dir && path.startsWith(`${dir}/`)) return { path, label: `~${path.slice(dir.length)}` }
  return { path, label: path }
}

// The .md files a reply named, the last named first: the file_path of its file tools, then the
// paths in its text.
function named(message: SessionMessage): string[] {
  const found: string[] = []
  for (const use of message.toolUses) {
    const path = use.input.file_path
    if (FILE_TOOLS.has(use.tool) && typeof path === 'string' && MARKDOWN.test(path)) found.push(path)
  }
  found.push(...(message.text.match(PATH_IN_TEXT) ?? []))
  return found.reverse()
}

async function recentMessages($: Api): Promise<SessionMessage[]> {
  const messages = await $.session.messages()
  return Array.isArray(messages) ? messages.slice(-RECENT_MESSAGES) : []
}

// The existing .md files the replies among `messages` named, newest first, each once.
async function existing($: Api, messages: readonly SessionMessage[]): Promise<string[]> {
  const paths: string[] = []
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue
    for (const candidate of named(message)) {
      const path = await absolute($, candidate)
      if (!paths.includes(path) && (await $.fs.exists(path))) paths.push(path)
    }
  }
  return paths
}

// The messages since the person's last prompt: a user message that carries no tool results.
function sinceLastPrompt(messages: readonly SessionMessage[]): readonly SessionMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role === 'user' && !message.toolResults?.length) return messages.slice(i + 1)
  }
  return messages
}

// The project's Markdown files relative to the working directory: git's list (untracked ones
// too, ignored ones not), else fd's outside a repository, else none.
async function projectFiles($: Api): Promise<string[]> {
  const run = (argv: string[]) => $.process.run(argv).catch(() => undefined)
  const git = await run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md', '*.markdown'])
  if (git?.exitCode === 0) return git.stdout.split('\0').filter(Boolean)
  const fd = await run(['fd', '--type', 'f', '--extension', 'md', '--extension', 'markdown', '--hidden', '--exclude', '.git'])
  if (fd?.exitCode === 0) return fd.stdout.split('\n').filter(Boolean)
  return []
}

// The labels of the .md files to choose from: those the conversation named, then the project's.
async function candidates($: Api): Promise<string[]> {
  const labels: string[] = []
  for (const path of await existing($, await recentMessages($))) {
    labels.push((await describe($, path)).label)
  }
  labels.push(...(await projectFiles($)))
  return [...new Set(labels)]
}

// The file /md <arg> means: the path itself when it exists, else the best match of the
// candidates for the words given.
async function resolveArg($: Api, arg: string): Promise<string | undefined> {
  const path = await absolute($, arg)
  if (await $.fs.exists(path)) return path
  const [best] = rank(arg, await candidates($))
  return best === undefined ? undefined : absolute($, best)
}

async function mtime($: Api, path: string): Promise<number | undefined> {
  try {
    return (await $.fs.stat(path)).mtimeMs
  } catch {
    return undefined
  }
}

async function load($: Api, path: string): Promise<{ text: string; mtimeMs: number } | undefined> {
  try {
    const mtimeMs = (await mtime($, path)) ?? 0
    const text = await $.fs.read(path)
    return typeof text === 'string' ? { text, mtimeMs } : undefined
  } catch {
    return undefined
  }
}

// Opens `path` in the pane: true, or what to say about why not.
async function open($: Api, say: Messages, path: string): Promise<{ label: string } | { error: string }> {
  if (!MARKDOWN.test(path)) return { error: say.notMarkdown(path) }
  const loaded = await load($, path)
  if (!loaded) return { error: say.unreadable(path) }
  const file = await describe($, path)
  await update($, doc, () => ({ ...file, ...loaded }))
  await update($, offer, () => null)
  await $.ui.open({ id: PANE, title: basename(path) })
  return { label: file.label }
}

async function close($: Api): Promise<void> {
  await update($, doc, () => null)
  await $.ui.close({ id: PANE })
}

// Reads the open file again when it changed on disk since it was read; a file gone stays shown.
async function refresh($: Api): Promise<void> {
  const shown = await read($, doc)
  if (!shown) return
  const now = await mtime($, shown.path)
  if (now === undefined || now === shown.mtimeMs) return
  const loaded = await load($, shown.path)
  if (loaded) await update($, doc, current => (current?.path === shown.path ? { ...current, ...loaded } : current))
}

// The language option as set: auto, en or ja.
let configured = 'auto'
let detected: Lang | undefined

// The language set in the options; with auto, Claude Code's language setting, then the locale.
async function language($: Api): Promise<Lang> {
  const chosen = languageOf(configured)
  if (chosen) return chosen
  if (detected) return detected
  const rows = await $.config.list().catch(() => [])
  const setting = rows.find(row => row.key === 'language')?.value
  const locale =
    (await $.env.get('LC_ALL').catch(() => undefined)) ||
    (await $.env.get('LC_MESSAGES').catch(() => undefined)) ||
    (await $.env.get('LANG').catch(() => undefined))
  detected = languageOf(typeof setting === 'string' ? setting : undefined) ?? languageOf(locale) ?? 'en'
  return detected
}

async function messages($: Api): Promise<Messages> {
  return MESSAGES[await language($)]
}

export const register: Register = (on, options: PluginOptions) => {
  configured = String(options.language ?? 'auto')
  detected = undefined

  on('session.start', async ($, e, next) => {
    const say = await messages($)
    await $.command.register({ name: 'md', description: say.command, argumentHint: say.argument, immediate: true })
    $.clock.every(WATCH_MS, () => {
      refresh($).catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'md' }, async ($, e) => {
    const say = await messages($)
    const arg = e.args.trim()
    let path: string | undefined
    if (arg) {
      path = await resolveArg($, arg)
      if (!path) return { text: say.notFound(arg) }
    } else {
      ;[path] = await existing($, await recentMessages($))
      if (!path) return { text: say.noneRecent }
    }
    const opened = await open($, say, path)

    return { text: 'error' in opened ? opened.error : say.opened(opened.label) }
  })

  // Complete the argument of /md: the .md files the conversation named, then the project's.
  on('prompt.autocomplete', async ($, e, next) => {
    const base = await next(e)
    if (!/^\/md\s/.test(e.text) || e.start < 4) return base
    try {
      const mine = rank(e.token, await candidates($))
        .slice(0, MAX_SUGGESTIONS)
        .map(label => ({ text: label, label: basename(label), description: label }))

      return { suggestions: [...base.suggestions, ...mine] }
    } catch {
      return base
    }
  })

  // Offer the .md the reply just named, unless it is the one open.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      const [path] = await existing($, sinceLastPrompt(await recentMessages($)))
      const shown = await read($, doc)
      const file = path && path !== shown?.path ? await describe($, path) : null
      await update($, offer, () => file)
    } catch {
      // No offer this time.
    }

    return result
  })

  // The person closed the pane (Esc, its close mark).
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, doc, () => null).catch(() => undefined)

    return next(e)
  }).catch((_, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const shown = await read($, doc)
    if (!shown) return <Text dimColor>{(await messages($)).emptyPane}</Text>

    return (
      <Box flexDirection="column">
        <Text dimColor>{shown.label}</Text>
        <Markdown text={shown.text} />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, doc)
    const offered = await read($, offer)
    if (e.props.hasSurvey || (!shown && !offered)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const say = await messages($)

    const quoteSelection = async () => {
      const current = await read($, doc)
      const selected = await $.ui.selection()
      if (!current || !selected || selected.text.trim() === '') {
        $.ui.toast(say.selectFirst)
        return
      }
      const draft = (await $.prompt.read()).text
      const gap = draft === '' || draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n'
      const head = cite(current.label, locate(current.text, selected.text))
      await $.prompt.fill({ text: `${gap}${head}\n${quote(selected.text)}\n\n`, mode: 'append' })
    }
    const reload = async () => {
      const current = await read($, doc)
      if (!current) return
      const loaded = await load($, current.path)
      if (!loaded) {
        $.ui.toast(say.unreadable(current.label))
        return
      }
      await update($, doc, () => ({ ...current, ...loaded }))
    }
    const openOffered = async () => {
      if (!offered) return
      const opened = await open($, say, offered.path)
      if ('error' in opened) $.ui.toast(opened.error)
    }

    return (
      <Box gap={1}>
        {shown && <Text dimColor>{shown.label}</Text>}
        {shown && <Button key="quote" label={say.quote} hotkey="q" onPress={quoteSelection} />}
        {shown && <Button key="reload" label={say.reload} hotkey="r" onPress={reload} />}
        {shown && <Button key="close" label={say.close} onPress={() => close($)} />}
        {offered && <Button key="offer" label={say.open(offered.label)} hotkey="o" onPress={openOffered} />}
        {offered && <Button key="dismiss" label={say.dismiss} onPress={() => update($, offer, () => null)} />}
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, SessionMessage } from 'claude-code'

import type { Doc, MdFile, View } from '../types'
import { languageOf, MESSAGES } from './messages'
import type { Lang, Messages } from './messages'
import { basename, cite, clip, count, diff, dirname, frontMatter, hunks, lines, linkify, locate, normalize, quote, rank, ungutter } from './text'
import type { Change } from './text'

// md-review: read a Markdown file rendered in a pane beside the chat and quote passages of it
// into the prompt, so a review needs no other tab, editor or browser.
//   /md [path]   opens the file: a path, part of a file name, or without one the newest .md
//                the conversation named; its argument completes to the conversation's and
//                the project's Markdown files
//   the pane     the file rendered, as written with line numbers, or the changes since the
//                person's last message; it follows the file on disk, and a relative link to
//                another Markdown file opens that file in it
//   the band     above the prompt: quote the mouse selection headed by its file and lines,
//                switch the view, go back, close, and an offer to open the .md the last
//                reply named

type Api = EngineInterface
// Where relative and ~/ paths start.
type Where = { cwd: string; home: string | undefined }

const PANE = 'md-review'
const doc = atom({ plugin: 'md-review', key: 'doc' } as const, null, { shape: 'doc-5' })
const offer = atom({ plugin: 'md-review', key: 'offer' } as const, null, { shape: 'offer-1' })

const MARKDOWN = /\.(md|markdown)$/i
// A path ending in .md inside a reply, stopping at spaces, quotes, backticks and brackets.
const PATH_IN_TEXT = /[^\s`'"()<>[\]{}|,]+\.(?:md|markdown)(?![\w/])/gi
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'Read'])
// How far back /md without a path and the completion look.
const RECENT_MESSAGES = 30
const MAX_SUGGESTIONS = 10
// How long completion reuses the project's file list, so typing does not list it per key.
const LIST_TTL_MS = 5000
// How often the open file is checked for changes on disk.
const WATCH_MS = 1000
// The most text the pane draws, under the 100000 characters a drawing takes.
const DRAW_LIMIT = 90_000
// The most links in one drawing the pane answers.
const MAX_LINKS = 256

async function where($: Api): Promise<Where> {
  return { cwd: await $.session.cwd(), home: await $.env.get('HOME') }
}

function absolute(at: Where, path: string): string {
  if (path.startsWith('/')) return normalize(path)
  if (path.startsWith('~/')) return normalize(`${at.home ?? '~'}${path.slice(1)}`)
  return normalize(`${at.cwd}/${path}`)
}

function describe(at: Where, path: string): MdFile {
  if (path.startsWith(`${at.cwd}/`)) return { path, label: path.slice(at.cwd.length + 1) }
  if (at.home && path.startsWith(`${at.home}/`)) return { path, label: `~${path.slice(at.home.length)}` }
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
async function existing($: Api, at: Where, messages: readonly SessionMessage[]): Promise<string[]> {
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

// The messages since the person's last prompt: a user message that carries no tool results.
function sinceLastPrompt(messages: readonly SessionMessage[]): readonly SessionMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role === 'user' && !message.toolResults?.length) return messages.slice(i + 1)
  }
  return messages
}

// The project's file list completion last took, reused for LIST_TTL_MS.
let listed: { cwd: string; at: number; files: string[] } | undefined

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
async function candidates($: Api, at: Where, fresh: boolean): Promise<string[]> {
  const named = (await existing($, at, await recentMessages($))).map(path => describe(at, path).label)
  return [...new Set([...named, ...(await projectFiles($, at.cwd, fresh))])]
}

// The file /md <arg> means: the path itself when it exists, else the best match of the
// candidates for the words given.
async function resolveArg($: Api, at: Where, arg: string): Promise<string | undefined> {
  const path = absolute(at, arg)
  if (await $.fs.exists(path)) return path
  const [best] = rank(arg, await candidates($, at, true))
  return best === undefined ? undefined : absolute(at, best)
}

// The file's modification time, or undefined when it is not there.
async function mtime($: Api, path: string): Promise<number | undefined> {
  try {
    const stat = await $.fs.stat(path)
    return stat.kind === 'file' ? stat.mtimeMs : undefined
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

type Opened = { label: string } | { error: string }

// Shows `path` in the pane, its Back list made by `back` from what was shown. The same file
// shown again keeps its base and view; another starts rendered, its text as read the base.
async function show($: Api, say: Messages, path: string, back: (shown: Doc | null) => string[]): Promise<Opened> {
  if (!MARKDOWN.test(path)) return { error: say.notMarkdown(path) }
  const loaded = await load($, path)
  if (!loaded) return { error: say.unreadable(path) }
  const file = describe(await where($), path)
  await update($, doc, shown => {
    const same = shown?.path === path ? shown : undefined
    return {
      ...file,
      ...loaded,
      base: same?.base ?? loaded.text,
      isDeleted: false,
      view: same?.view ?? ('rendered' as const),
      back: back(shown),
    }
  })
  await update($, offer, offered => (offered?.path === path ? null : offered))
  await $.ui.open({ id: PANE, title: basename(path) })
  return { label: file.label }
}

// Opens a file the person chose (not by a link), so Back starts over.
async function openAnew($: Api, say: Messages, path: string): Promise<Opened> {
  return show($, say, path, () => [])
}

// Follows a link from the shown file to `path`, so Back returns to the shown file.
async function follow($: Api, say: Messages, path: string): Promise<void> {
  const opened = await show($, say, path, shown => (shown ? [...shown.back, shown.path] : []))
  if ('error' in opened) $.ui.toast(opened.error)
}

// Returns to the file the last link was followed from; one that cannot be read is dropped.
async function goBack($: Api, say: Messages): Promise<void> {
  const shown = await read($, doc)
  const previous = shown?.back[shown.back.length - 1]
  if (!shown || previous === undefined) return
  const rest = shown.back.slice(0, -1)
  const opened = await show($, say, previous, () => rest)
  if ('error' in opened) {
    $.ui.toast(opened.error)
    await update($, doc, current => (current ? { ...current, back: rest } : current))
  }
}

async function setView($: Api, to: View): Promise<void> {
  await update($, doc, shown => (shown ? { ...shown, view: shown.view === to ? 'rendered' : to } : shown))
}

async function close($: Api): Promise<void> {
  await update($, doc, () => null)
  await $.ui.close({ id: PANE })
}

// The file as it stands becomes the base the changes are counted from.
async function rebase($: Api): Promise<void> {
  await update($, doc, shown =>
    shown && (shown.base !== shown.text || shown.view === 'changes')
      ? { ...shown, base: shown.text, view: shown.view === 'changes' ? 'rendered' : shown.view }
      : shown,
  )
}

// Whether a refresh is under way, so a slow read is not started again on the next tick.
let refreshing = false

// Reads the shown file again when it changed on disk since it was read. A file gone stays shown,
// marked as gone until it is back.
async function refresh($: Api): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    const shown = await read($, doc)
    if (!shown) return
    const now = await mtime($, shown.path)
    if (now === shown.mtimeMs && !shown.isDeleted) return
    const loaded = now === undefined ? undefined : await load($, shown.path)
    if (!loaded && shown.isDeleted) return
    await update($, doc, current => {
      if (current?.path !== shown.path) return current
      return loaded ? { ...current, ...loaded, isDeleted: false } : { ...current, isDeleted: true }
    })
  } finally {
    refreshing = false
  }
}

// The changes from the shown file's base to its text, worked out once for each pair.
let compared: { base: string; text: string; changes: Change[] } | undefined
function changesOf(shown: Doc): Change[] {
  if (compared?.base !== shown.base || compared.text !== shown.text) {
    compared = { base: shown.base, text: shown.text, changes: diff(shown.base, shown.text) }
  }
  return compared.changes
}

async function quoteSelection($: Api, say: Messages): Promise<void> {
  const shown = await read($, doc)
  const selected = await $.ui.selection()
  if (!shown || !selected || selected.text.trim() === '') {
    $.ui.toast(say.selectFirst)
    return
  }
  const draft = (await $.prompt.read()).text
  const gap = draft === '' || draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n'
  // A selection from the source view may carry its line numbers, which tell the lines.
  const numbered = shown.view === 'source' ? ungutter(shown.text, selected.text) : undefined
  const text = numbered?.text ?? selected.text
  const head = cite(shown.label, numbered?.lines ?? locate(shown.text, selected.text))
  await $.prompt.fill({ text: `${gap}${head}\n${quote(text)}\n\n`, mode: 'append' })
}

// Offers the .md the reply since the last prompt named last, unless it is the one shown.
async function offerNamed($: Api): Promise<void> {
  const at = await where($)
  const [path] = await existing($, at, sinceLastPrompt(await recentMessages($)))
  const shown = await read($, doc)
  const file = path && path !== shown?.path ? describe(at, path) : null
  await update($, offer, () => file)
}

async function openOffered($: Api, say: Messages): Promise<void> {
  const offered = await read($, offer)
  if (!offered) return
  const opened = await openAnew($, say, offered.path)
  if ('error' in opened) $.ui.toast(opened.error)
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
  // A load starts over: what the last load worked out may not hold for this one.
  configured = String(options.language ?? 'auto')
  detected = undefined
  listed = undefined
  refreshing = false

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
    const at = await where($)
    const arg = e.args.trim()
    let path: string | undefined
    if (arg) {
      path = await resolveArg($, at, arg)
      if (!path) return { text: say.notFound(arg) }
    } else {
      ;[path] = await existing($, at, await recentMessages($))
      if (!path) return { text: say.noneRecent }
    }
    const opened = await openAnew($, say, path)

    return { text: 'error' in opened ? opened.error : say.opened(opened.label) }
  })

  // Complete the argument of /md: the .md files the conversation named, then the project's.
  on('prompt.autocomplete', async ($, e, next) => {
    const base = await next(e)
    if (!/^\/md\s/.test(e.text) || e.start < 4) return base
    try {
      const mine = rank(e.token, await candidates($, await where($), false))
        .slice(0, MAX_SUGGESTIONS)
        .map(label => ({ text: label, label: basename(label), description: label }))

      return { suggestions: [...base.suggestions, ...mine] }
    } catch {
      return base
    }
  })

  // The person's message (not a slash command) starts the count of changes again.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta) await rebase($).catch(() => undefined)

    return next(e)
  }).catch((_, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await offerNamed($).catch(() => undefined)

    return result
  })

  // The person closed the pane (Esc, its close mark).
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, doc, () => null).catch(() => undefined)

    return next(e)
  }).catch((_, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Code, Markdown, Text } = $.ui.resolve(e)
    const say = await messages($)
    const shown = await read($, doc)
    if (!shown) return <Text dimColor>{say.emptyPane}</Text>

    const notes = [say.lineCount(lines(shown.text).length)]
    let isCut = false
    let body
    if (shown.view === 'source') {
      notes.push(say.sourceView)
      const drawn = clip(shown.text, DRAW_LIMIT)
      isCut = drawn.isCut
      body = <Code source={drawn.text} language="markdown" startLine={1} />
    } else if (shown.view === 'changes') {
      notes.push(say.changesView)
      const drawn = clip(hunks(changesOf(shown)), DRAW_LIMIT, '\n@@')
      isCut = drawn.isCut
      body = drawn.text ? <Code source={drawn.text} format="diff" /> : <Text dimColor>{say.noChanges}</Text>
    } else {
      const drawn = clip(shown.text, DRAW_LIMIT)
      isCut = drawn.isCut
      const { text, links } = linkify(frontMatter(drawn.text), dirname(shown.path))
      const pressable = [...links.keys()].slice(0, MAX_LINKS)
      const press = (link: { href: string }) => {
        const target = links.get(link.href)
        if (target) return follow($, say, target)
      }
      body = pressable.length ? (
        <Markdown key="doc" text={text} pressableLinks={pressable} onLinkPress={press} />
      ) : (
        <Markdown key="doc" text={text} />
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box key="header">
          <Text>
            <Text weight="bold">{shown.label}</Text>
            <Text dimColor>{notes.map(note => ` · ${note}`).join('')}</Text>
            {shown.isDeleted && <Text color="error">{` · ${say.deleted}`}</Text>}
            {isCut && <Text color="warning">{` · ${say.cut}`}</Text>}
          </Text>
        </Box>
        {body}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, doc)
    const offered = await read($, offer)
    if (e.props.hasSurvey || (!shown && !offered)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const say = await messages($)
    const { added, removed } = shown ? count(changesOf(shown)) : { added: 0, removed: 0 }

    return (
      <Box gap={1} flexWrap="wrap">
        {shown && <Text dimColor>{shown.label}</Text>}
        {shown && <Button key="quote" label={say.quote} hotkey="q" variant="primary" onPress={() => quoteSelection($, say)} />}
        {shown && (
          <Button
            key="source"
            label={shown.view === 'source' ? say.rendered : say.source}
            hotkey="s"
            onPress={() => setView($, 'source')}
          />
        )}
        {shown && (shown.view === 'changes' || added + removed > 0) && (
          <Button
            key="changes"
            label={shown.view === 'changes' ? say.hideChanges : say.changes(added, removed)}
            hotkey="d"
            onPress={() => setView($, 'changes')}
          />
        )}
        {shown && shown.back.length > 0 && <Button key="back" label={say.back} hotkey="b" onPress={() => goBack($, say)} />}
        {shown && <Button key="close" label={say.close} dimColor onPress={() => close($)} />}
        {offered && <Button key="offer" label={say.open(offered.label)} hotkey="o" onPress={() => openOffered($, say)} />}
        {offered && <Button key="dismiss" label={say.dismiss} dimColor onPress={() => update($, offer, () => null)} />}
      </Box>
    )
  })
}

// The file the pane shows and the file offered in the band: their state, and every step that
// changes them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Doc, MdFile, View } from '../types'
import { diff, lines } from './diff'
import type { Change } from './diff'
import { existing, load, mtime, recentMessages, sinceLastPrompt, where } from './files'
import type { Messages } from './messages'
import { basename, describe, MARKDOWN } from './paths'
import { cite, locate, quote, ungutter } from './quote'

type Api = EngineInterface

export const PANE = 'md-review'
// The width the docked pane asks for.
const READING_COLUMNS = 100
// The pane's header line and the gap under it.
const HEADER_ROWS = 2
// The pane's background in a dark theme: the terminal's own, painted under nothing else.
const DARK_BACKGROUND = 'transparent'
// Read and written only in this file: the state library lists a module's values from the
// atoms each file names.
const doc = atom({ plugin: 'md-review', key: 'doc' } as const, null, { shape: 'doc-5' })
const offer = atom({ plugin: 'md-review', key: 'offer' } as const, null, { shape: 'offer-1' })

// The shown file, for a drawing, which a change to it then redraws.
export async function shownDoc($: Api): Promise<Doc | null> {
  return read($, doc)
}

// The offered file, for a drawing, which a change to it then redraws.
export async function offeredFile($: Api): Promise<MdFile | null> {
  return read($, offer)
}

// Whether a refresh is under way, so a slow read is not started again on the next tick.
let refreshing = false
// The changes from a base to a text, worked out once for each pair.
let compared: { base: string; text: string; changes: Change[] } | undefined

// Forgets what an earlier load of the module was doing.
export function resetDoc(): void {
  refreshing = false
  compared = undefined
}

type Opened = { label: string } | { error: string }

// The pane's background: in a dark theme the terminal's, as the transcript beside it has, since
// the engine's own there is the palette's bright black in the ANSI themes (#555555 in many),
// which washes out light text; in any other theme the engine's own.
async function background($: Api): Promise<string | undefined> {
  const rows = await $.config.list().catch(() => [])
  const theme = rows.find(row => row.key === 'theme')?.value
  return typeof theme === 'string' && theme.startsWith('dark') ? DARK_BACKGROUND : undefined
}

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
  const backgroundColor = await background($)
  await $.ui.open({
    id: PANE,
    title: basename(path),
    // Escape closes it, from the pane or an idle, empty prompt.
    closeOnEscape: true,
    // Docked beside the transcript: a width to read prose and tables in (the engine caps it
    // at 45% of the terminal, and a width the person set wins).
    columns: READING_COLUMNS,
    // Inline above the prompt: the file's height with its header, up to what the layout
    // spares, rather than a third of the screen.
    rows: lines(loaded.text).length + HEADER_ROWS,
    ...(backgroundColor ? { backgroundColor } : {}),
  })
  return { label: file.label }
}

// Opens a file the person chose (not by a link), so Back starts over.
export async function openAnew($: Api, say: Messages, path: string): Promise<Opened> {
  return show($, say, path, () => [])
}

// Follows a link from the shown file to `path`, so Back returns to the shown file.
export async function follow($: Api, say: Messages, path: string): Promise<void> {
  const opened = await show($, say, path, shown => (shown ? [...shown.back, shown.path] : []))
  if ('error' in opened) $.ui.toast(opened.error)
}

// Returns to the file the last link was followed from; one that cannot be read is dropped.
export async function goBack($: Api, say: Messages): Promise<void> {
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

// Switches to `to`, or back to rendered when it is the view already.
export async function toggleView($: Api, to: View): Promise<void> {
  await update($, doc, shown => (shown ? { ...shown, view: shown.view === to ? 'rendered' : to } : shown))
}

export async function close($: Api): Promise<void> {
  await update($, doc, () => null)
  await $.ui.close({ id: PANE })
}

// The pane was closed from outside (Esc, its close mark).
export async function forget($: Api): Promise<void> {
  await update($, doc, () => null)
}

// The file as it stands becomes the base the changes are counted from.
export async function rebase($: Api): Promise<void> {
  await update($, doc, shown =>
    shown && (shown.base !== shown.text || shown.view === 'changes')
      ? { ...shown, base: shown.text, view: shown.view === 'changes' ? 'rendered' : shown.view }
      : shown,
  )
}

// Reads the shown file again when it changed on disk since it was read. A file gone stays shown,
// marked as gone until it is back.
export async function refresh($: Api): Promise<void> {
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

// The changes from the shown file's base to its text.
export function changesOf(shown: Doc): Change[] {
  if (compared?.base !== shown.base || compared.text !== shown.text) {
    compared = { base: shown.base, text: shown.text, changes: diff(shown.base, shown.text) }
  }
  return compared.changes
}

// Appends the person's selection to the draft as a quote headed by its file and lines.
export async function quoteSelection($: Api, say: Messages): Promise<void> {
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

// Offers the .md the replies since the last prompt named last, unless it is the one shown.
export async function offerNamed($: Api): Promise<void> {
  const at = await where($)
  const [path] = await existing($, at, sinceLastPrompt(await recentMessages($)))
  const shown = await read($, doc)
  const file = path && path !== shown?.path ? describe(at, path) : null
  await update($, offer, () => file)
}

export async function openOffered($: Api, say: Messages): Promise<void> {
  const offered = await read($, offer)
  if (!offered) return
  const opened = await openAnew($, say, offered.path)
  if ('error' in opened) $.ui.toast(opened.error)
}

export async function dismissOffer($: Api): Promise<void> {
  await update($, offer, () => null)
}

// The file view: the file shown and the .md offered in the band, their state, and every step
// that changes them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { FileDoc, FileMode, Location, MdFile } from '../../types'
import { existing, load, mtime, recentMessages, sinceLastPrompt, where } from '../find'
import type { Kind } from '../find'
import type { Messages } from '../messages'
import { diff, lines } from '../pure/diff'
import type { Change } from '../pure/diff'
import { basename, describe, MARKDOWN } from '../pure/paths'
import { cite, locate, ungutter } from '../pure/quote'

type Api = EngineInterface

// The key of the Box that holds the lines a file was opened at, which the pane scrolls to.
export const LINE_KEY = 'peek-line'
// The pane's header line and the gap under it.
const HEADER_ROWS = 2

// Read and written only in this file: the state library lists a module's values from the
// atoms each file names.
const file = atom({ plugin: 'peek', key: 'file' } as const, null, { shape: 'file-1' })
const offer = atom({ plugin: 'peek', key: 'offer' } as const, null, { shape: 'offer-1' })

// The shown file, for a drawing, which a change to it then redraws.
export async function shownFile($: Api): Promise<FileDoc | null> {
  return read($, file)
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
export function resetFile(): void {
  refreshing = false
  compared = undefined
}

// What opening a view came to: the pane's title and size, the label to report, and the element
// to scroll to; or what to say about why not.
export type Opened = { title: string; label: string; rows: number; scrollKey?: string } | { error: string }

// Loads `path` into the file view, at `lines` when given. The same file loaded again keeps its
// base and mode; another starts rendered (Markdown) or as source, its text as read the base.
// Lines show the source. `kind` markdown refuses any other file.
export async function loadFile($: Api, say: Messages, path: string, at: [number, number] | undefined, kind: Kind): Promise<Opened> {
  const isMarkdown = MARKDOWN.test(path)
  if (kind === 'markdown' && !isMarkdown) return { error: say.notMarkdown(path) }
  const loaded = await load($, path)
  if ('problem' in loaded) {
    const problems = { unreadable: say.unreadable, binary: say.notText, large: say.tooLarge }
    return { error: problems[loaded.problem](path) }
  }
  const described = describe(await where($), path)
  await update($, file, shown => {
    const same = shown?.path === path ? shown : undefined
    const mode = at ? 'source' : (same?.mode ?? (isMarkdown ? 'rendered' : 'source'))
    return {
      ...described,
      ...loaded,
      base: same?.base ?? loaded.text,
      isDeleted: false,
      isMarkdown,
      mode,
      ...(at ? { lines: at } : {}),
    }
  })
  await update($, offer, offered => (offered?.path === path ? null : offered))
  return {
    title: basename(path),
    label: described.label,
    rows: lines(loaded.text).length + HEADER_ROWS,
    ...(at ? { scrollKey: LINE_KEY } : {}),
  }
}

// Where the file view is, for Back.
export async function fileLocation($: Api): Promise<Location | undefined> {
  const shown = await read($, file)
  if (!shown) return undefined
  return { view: 'file', path: shown.path, ...(shown.lines ? { lines: shown.lines } : {}) }
}

// The mode a file rests in when the changes are put away: rendered for Markdown opened whole,
// else the source.
function resting(shown: FileDoc): FileMode {
  return shown.isMarkdown && !shown.lines ? 'rendered' : 'source'
}

// Source switches Markdown between its source and its rendering; changes switches them on and
// back off.
export async function toggleFileMode($: Api, to: 'source' | 'changes'): Promise<void> {
  await update($, file, shown => {
    if (!shown) return shown
    const toggled: FileMode = to === 'source' ? 'rendered' : resting(shown)
    return { ...shown, mode: shown.mode === to ? toggled : to }
  })
}

// The file as it stands becomes the base the changes are counted from.
export async function rebaseFile($: Api): Promise<void> {
  await update($, file, shown =>
    shown && (shown.base !== shown.text || shown.mode === 'changes')
      ? { ...shown, base: shown.text, mode: shown.mode === 'changes' ? resting(shown) : shown.mode }
      : shown,
  )
}

// Reads the shown file again when it changed on disk since it was read. A file gone stays shown,
// marked as gone until it is back.
export async function refreshFile($: Api): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    const shown = await read($, file)
    if (!shown) return
    const now = await mtime($, shown.path)
    if (now === shown.mtimeMs && !shown.isDeleted) return
    const loaded = now === undefined ? undefined : await load($, shown.path)
    const text = loaded && 'text' in loaded ? loaded : undefined
    if (!text && shown.isDeleted) return
    await update($, file, current => {
      if (current?.path !== shown.path) return current
      return text ? { ...current, ...text, isDeleted: false } : { ...current, isDeleted: true }
    })
  } finally {
    refreshing = false
  }
}

// The changes from the shown file's base to its text.
export function changesOf(shown: FileDoc): Change[] {
  if (compared?.base !== shown.base || compared.text !== shown.text) {
    compared = { base: shown.base, text: shown.text, changes: diff(shown.base, shown.text) }
  }
  return compared.changes
}

// A selection from the file view, headed by the file and its lines: in the source view by the
// line numbers it carries, else by finding it in the file; by the file alone when not found.
export async function fileQuote($: Api, selected: string): Promise<{ head: string; text: string } | undefined> {
  const shown = await read($, file)
  if (!shown) return undefined
  const numbered = shown.mode === 'source' ? ungutter(shown.text, selected) : undefined
  return {
    head: cite(shown.label, numbered?.lines ?? locate(shown.text, selected)),
    text: numbered?.text ?? selected,
  }
}

// The shown file's label, to mention it.
export async function fileMention($: Api): Promise<string | undefined> {
  return (await read($, file))?.label
}

// Offers the .md the replies since the last prompt named last, unless it is the one shown.
export async function offerNamed($: Api): Promise<void> {
  const at = await where($)
  const [path] = await existing($, at, sinceLastPrompt(await recentMessages($)), 'markdown')
  const shown = await read($, file)
  const offered = path && path !== shown?.path ? describe(at, path) : null
  await update($, offer, () => offered)
}

export async function dismissOffer($: Api): Promise<void> {
  await update($, offer, () => null)
}

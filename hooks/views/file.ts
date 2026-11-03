// The file view: the file shown and the file offered in the band, their state, and every step
// that changes them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { FileDoc, FileMode, Location, Offer } from '../../types'
import { existing, load, mtime, recentMessages, sinceLastPrompt, where } from '../find'
import type { Kind } from '../find'
import type { Messages } from '../messages'
import type { Opened } from '../nav'
import { diff, lines } from '../pure/diff'
import type { Change } from '../pure/diff'
import { basename, describe, MARKDOWN } from '../pure/paths'
import { cite, locate, ungutter } from '../pure/quote'
import type { Quoted } from '../pure/quote'

type Api = EngineInterface

// The key of the Box that holds the lines a file was opened at, which the pane scrolls to.
export const LINE_KEY = 'peek-line'

// Read and written only in this file: the state library lists a module's values from the
// atoms each file names.
const file = atom({ plugin: 'peek', key: 'file' } as const, null, { shape: 'file-1' })
const offer = atom({ plugin: 'peek', key: 'offer' } as const, null, { shape: 'offer-1' })

// The shown file, for a drawing, which a change to it then redraws.
export async function shownFile($: Api): Promise<FileDoc | null> {
  return read($, file)
}

// The offered file, for a drawing, which a change to it then redraws.
export async function offeredFile($: Api): Promise<Offer | null> {
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

// The file's text, or why it cannot be shown. The file shown that cannot be read now keeps what
// was last read of it, marked when it is gone from the disk, as refreshFile keeps it on screen.
async function current($: Api, path: string): Promise<{ text: string; mtimeMs: number; isDeleted: boolean } | { problem: 'unreadable' | 'binary' | 'large' }> {
  const found = await load($, path)
  if (!('problem' in found)) return { ...found, isDeleted: false }
  const shown = await read($, file)
  if (shown?.path !== path) return found
  const now = await mtime($, path)
  return { text: shown.text, mtimeMs: now ?? shown.mtimeMs, isDeleted: now === undefined }
}

// Loads `path` into the file view, at `lines` when given. The same file loaded again keeps its
// base and mode, and what was read of it when it cannot be read now; another starts rendered
// (Markdown) or as source, its text as read the base. Lines show the source. `kind` markdown
// refuses any other file.
export async function loadFile($: Api, say: Messages, path: string, at: [number, number] | undefined, kind: Kind): Promise<Opened> {
  const isMarkdown = MARKDOWN.test(path)
  if (kind === 'markdown' && !isMarkdown) return { error: say.notMarkdown(path) }
  const loaded = await current($, path)
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
      isMarkdown,
      mode,
      ...(at ? { lines: at } : {}),
    }
  })
  // Opening the file offered takes the offer, at its lines when it has some.
  await update($, offer, offered => (offered?.path === path && (!offered.lines || sameLines(offered.lines, at)) ? null : offered))
  return {
    title: basename(path),
    label: described.label,
    lines: lines(loaded.text).length,
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

// Reads the shown file again when it changed on disk since it was read, or went or came back. A
// file gone stays shown, marked as gone until it is back; one there that cannot be shown any more
// (too large, binary) keeps what was shown until it changes again.
export async function refreshFile($: Api): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    const shown = await read($, file)
    if (!shown) return
    const now = await mtime($, shown.path)
    if (now === undefined ? shown.isDeleted : now === shown.mtimeMs && !shown.isDeleted) return
    const loaded = await current($, shown.path)
    if ('problem' in loaded) return
    await update($, file, held => (held?.path === shown.path ? { ...held, ...loaded } : held))
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
export async function fileQuote($: Api, selected: string): Promise<Quoted | undefined> {
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

const sameLines = (a: [number, number] | undefined, b: [number, number] | undefined) => cite('', a) === cite('', b)
const offerKey = (offered: Offer | null) => (offered ? cite(offered.path, offered.lines) : '')

// Offers what the replies since the last prompt pointed at last: a .md they named (to read
// rendered, so without lines), or a file at the lines they cited. A file named bare is not
// offered, as a reply names many in passing. Not offered when the pane shows it so already.
export async function offerNamed($: Api): Promise<void> {
  const at = await where($)
  const cited = (await existing($, at, sinceLastPrompt(await recentMessages($)), 'place')).find(
    named => MARKDOWN.test(named.path) || named.lines,
  )
  const lines = cited && !MARKDOWN.test(cited.path) ? cited.lines : undefined
  const shown = await read($, file)
  const isShown = cited !== undefined && shown?.path === cited.path && (!lines || sameLines(shown.lines, lines))
  const offered = cited && !isShown ? { ...describe(at, cited.path), ...(lines ? { lines } : {}) } : null
  if (offerKey(offered) !== offerKey(await read($, offer))) await update($, offer, () => offered)
}

export async function dismissOffer($: Api): Promise<void> {
  await update($, offer, () => null)
}

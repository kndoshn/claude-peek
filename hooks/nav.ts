// The pane and the way around it: whether it is open, which view it shows, going to a place in
// a view, and Back across views.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Location, Nav, ViewName } from '../types'
import type { Kind } from './find'
import type { Messages } from './messages'
import { commandLocation, loadCommand } from './views/command'
import { fileLocation, loadFile } from './views/file'
import { gitLocation, loadGit } from './views/git'
import { loadTree, treeLocation } from './views/tree'

type Api = EngineInterface

export const PANE = 'peek'
// The width the docked pane asks for.
const READING_COLUMNS = 100
// The pane's header line and the gap under it, above a view's lines.
const HEADER_ROWS = 2
// The pane's background in a dark theme: the terminal's own, painted under nothing else.
const DARK_BACKGROUND = 'transparent'

// What loading a view came to: the pane's title, the label to report, how many lines the view
// draws under its header, and the element to scroll to; or what to say about why not.
export type Opened = { title: string; label: string; lines: number; scrollKey?: string } | { error: string }

// Read and written only in this file (see views/file.ts).
const nav = atom({ plugin: 'peek', key: 'nav' } as const, { isOpen: false, view: null, back: [] }, { shape: 'nav-1' })

// The pane's state, for a drawing, which a change to it then redraws.
export async function navState($: Api): Promise<Nav> {
  return read($, nav)
}

// Loads a place into its view.
async function load($: Api, say: Messages, to: Location, kind: Kind): Promise<Opened> {
  switch (to.view) {
    case 'file':
      return loadFile($, say, to.path, to.lines, kind)
    case 'command':
      return loadCommand($, say)
    case 'tree':
      return loadTree($, say, to.root)
    case 'git':
      return loadGit($, say, to.commit)
    default:
      return { error: say.emptyPane }
  }
}

// Where a view is, for Back and for opening the pane again.
async function here($: Api, view: ViewName): Promise<Location | undefined> {
  switch (view) {
    case 'file':
      return fileLocation($)
    case 'command':
      return commandLocation($)
    case 'tree':
      return treeLocation($)
    case 'git':
      return gitLocation($)
    default:
      return undefined
  }
}

// The pane's background: in a dark theme the terminal's, as the transcript beside it has, since
// the engine's own there is the palette's bright black in the ANSI themes (#555555 in many),
// which washes out light text; in any other theme the engine's own.
async function background($: Api): Promise<string | undefined> {
  const rows = await $.config.list().catch(() => [])
  const theme = rows.find(row => row.key === 'theme')?.value
  return typeof theme === 'string' && theme.startsWith('dark') ? DARK_BACKGROUND : undefined
}

async function openPane($: Api, opened: Exclude<Opened, { error: string }>): Promise<void> {
  const backgroundColor = await background($)
  await $.ui.open({
    id: PANE,
    title: opened.title,
    // Escape closes it, from the pane or an idle, empty prompt.
    closeOnEscape: true,
    // Docked beside the transcript: a width to read prose and tables in (the engine caps it
    // at 45% of the terminal, and a width the person set wins).
    columns: READING_COLUMNS,
    // Inline above the prompt: the content's height, up to what the layout spares, rather
    // than a third of the screen.
    rows: opened.lines + HEADER_ROWS,
    ...(backgroundColor ? { backgroundColor } : {}),
  })
  // The open resolves once the pane is drawn, so the element is there to scroll to.
  if (opened.scrollKey) await $.ui.scroll({ to: { key: opened.scrollKey }, in: PANE, block: 'start' }).catch(() => undefined)
}

// Goes to `to` and shows the pane. `anew` (a command) starts Back over; `follow` (a link or a
// click in the pane) lets Back return to where the pane was.
export async function navigate($: Api, say: Messages, to: Location, how: 'anew' | 'follow', kind: Kind = 'place'): Promise<Opened> {
  const state = await read($, nav)
  const from = how === 'follow' && state.isOpen && state.view ? await here($, state.view) : undefined
  const opened = await load($, say, to, kind)
  if ('error' in opened) return opened
  await update($, nav, current => ({
    isOpen: true,
    view: to.view,
    back: how === 'anew' ? [] : from ? [...current.back, from] : current.back,
  }))
  await openPane($, opened)
  return opened
}

// Follows a link or a click, saying why not when the place cannot be shown.
export async function follow($: Api, say: Messages, to: Location): Promise<void> {
  const opened = await navigate($, say, to, 'follow')
  if ('error' in opened) $.ui.toast(opened.error)
}

// Returns to the place the last link or click was followed from; one that cannot be shown is
// dropped.
export async function goBack($: Api, say: Messages): Promise<void> {
  const state = await read($, nav)
  const previous = state.back[state.back.length - 1]
  if (previous === undefined) return
  const rest = state.back.slice(0, -1)
  const opened = await load($, say, previous, 'place')
  if ('error' in opened) {
    $.ui.toast(opened.error)
    await update($, nav, current => ({ ...current, back: rest }))
    return
  }
  await update($, nav, () => ({ isOpen: true, view: previous.view, back: rest }))
  await openPane($, opened)
}

// Shows the pane again at the place it last showed, or resolves undefined when it never showed.
export async function reopen($: Api, say: Messages): Promise<Opened | undefined> {
  const state = await read($, nav)
  const to = state.view ? await here($, state.view) : undefined
  if (!to) return undefined
  const opened = await load($, say, to, 'place')
  if ('error' in opened) return opened
  await update($, nav, current => ({ ...current, isOpen: true }))
  await openPane($, opened)
  return opened
}

// Shows `view` where it was, or its hint when it never showed anything; Back is left as it is.
export async function switchView($: Api, say: Messages, view: ViewName): Promise<void> {
  const to = await here($, view)
  const opened = to ? await load($, say, to, 'place') : { title: say.views[view], label: say.views[view], lines: 1 }
  if ('error' in opened) {
    $.ui.toast(opened.error)
    return
  }
  await update($, nav, current => ({ ...current, isOpen: true, view }))
  await openPane($, opened)
}

// The view the pane is open on, or null while it is closed.
export async function openView($: Api): Promise<ViewName | null> {
  const state = await read($, nav)
  return state.isOpen ? state.view : null
}

// Whether a surface shows the pane now: not while another tab stands in front of it or it waits
// undrawn. Shown when the engine cannot say.
export async function isPaneShown($: Api): Promise<boolean> {
  const panes = await $.ui.panes().catch(() => undefined)
  return panes === undefined || panes.some(pane => pane.id === PANE && pane.isShown)
}

export async function closePane($: Api): Promise<void> {
  await update($, nav, current => ({ ...current, isOpen: false, back: [] }))
  await $.ui.close({ id: PANE })
}

// The pane was closed from outside (Escape, its close mark).
export async function forgetPane($: Api): Promise<void> {
  await update($, nav, current => ({ ...current, isOpen: false, back: [] }))
}

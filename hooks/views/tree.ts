// The tree view: a folder's entries, the folders opened under it, Git's marks and what git
// ignores, read again while shown.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Location, TreeEntry, TreeState } from '../../types'
import { where } from '../find'
import type { Messages } from '../messages'
import type { Opened } from '../nav'
import { parseStatus, statusBadges } from '../pure/git'
import { fenced } from '../pure/markdown'
import { basename, describe, fromHome, join } from '../pure/paths'
import type { Where } from '../pure/paths'
import { locate } from '../pure/quote'
import type { Quoted } from '../pure/quote'
import { sortEntries, treeRows, treeText } from '../pure/tree'
import { now, rereads, runGit } from '../run'

type Api = EngineInterface

// How many rows the folders opened at first may add up to.
const FIRST_ROWS = 200
// The status of the folder shown and its branch (what git ignores is left out of it), without
// counting how far the branch is from its upstream, which the tree does not show.
const STATUS = ['status', '--porcelain=v2', '--branch', '--no-ahead-behind', '-z', '--untracked-files=normal', '--', '.']
const IGNORED = ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']

// Read and written only in this file (see views/file.ts).
const tree = atom({ plugin: 'peek', key: 'tree' } as const, null, { shape: 'tree-1' })

// The tree is checked every 5 seconds while shown, and read again when it moved.
const schedule = rereads(5000)
// The status the last read found, which tells on a timer whether git's marks moved.
let lastStatus: string | undefined

// Forgets what an earlier load of the module was doing.
export function resetTree(): void {
  schedule.reset()
  lastStatus = undefined
}

// Something may have changed the files (a turn ended, Claude ran a command or edited a file).
export function markTreeStale(): void {
  schedule.markStale()
}

// The tree shown, for a drawing, which a change to it then redraws.
export async function shownTree($: Api): Promise<TreeState | null> {
  return read($, tree)
}

// What a link leads to: a file, a folder, or other when it leads nowhere.
async function linkedKind($: Api, path: string): Promise<TreeEntry['kind']> {
  return (await $.fs.stat(path).catch(() => undefined))?.kind ?? 'other'
}

// A folder's entries, a link listed as what it leads to.
async function listDir($: Api, path: string): Promise<TreeEntry[] | undefined> {
  try {
    const entries = await $.fs.list(path)
    const kinds = await Promise.all(entries.map(entry => (entry.isLink ? linkedKind($, join(path, entry.name)) : entry.kind)))
    return sortEntries(entries.map((entry, i) => ({ name: entry.name, kind: kinds[i] ?? entry.kind, ...(entry.isLink ? { isLink: true } : {}) })))
  } catch {
    return undefined
  }
}

// The branch, Git's marks and what git ignores, when `root` is in a repository, read side by
// side, with the status as git printed it. git names the folder's place in the repository
// itself, so a path that reached it through a link still finds its marks, and it does before the
// first commit too. A detached head has no branch.
async function gitInfo($: Api, root: string): Promise<{ status?: string; branch?: string; badges: Record<string, string>; ignored: string[] }> {
  const [place, status, ignored] = await Promise.all([
    runGit($, ['rev-parse', '--show-prefix'], root),
    runGit($, STATUS, root),
    runGit($, IGNORED, root),
  ])
  const printed = status === undefined ? {} : { status }
  if (place === undefined) return { ...printed, badges: {}, ignored: [] }
  const prefix = place.replace(/\n$/, '').replace(/\/$/, '')
  const branch = status === undefined ? null : parseStatus(status).branch
  return {
    ...printed,
    ...(branch ? { branch } : {}),
    badges: status === undefined ? {} : statusBadges(status, prefix),
    ignored: ignored === undefined ? [] : ignored.split('\0').filter(Boolean),
  }
}

// A folder's label from the working directory, ending in a slash: ./ for the working directory
// itself, / for the top.
function folderLabel(at: Where, path: string): string {
  if (path === at.cwd) return './'
  return path === '/' ? '/' : `${describe(at, path).label}/`
}

// How a folder is labelled: from the home for the header (as pwd would print it), from the
// working directory for a quote's heading and a mention.
function labels(at: Where, root: string): Pick<TreeState, 'label' | 'heading' | 'name'> {
  return { label: fromHome(at.home, root), heading: folderLabel(at, root), name: root === '/' ? '/' : `${basename(root)}/` }
}

// The entries of each of `folders` under `root` ('' for the root itself), listed side by side; a
// folder that cannot be listed is left out.
async function listAll($: Api, root: string, folders: readonly string[]): Promise<TreeState['listings']> {
  const entries = await Promise.all(folders.map(folder => listDir($, folder ? join(root, folder) : root)))
  const listings: TreeState['listings'] = {}
  folders.forEach((folder, i) => {
    const listed = entries[i]
    if (listed) listings[folder] = listed
  })
  return listings
}

// Reads `root` into the tree view, its folders and git side by side. The folder shown again
// keeps what was opened and chosen; a new one opens its smaller folders, as many as fit in
// FIRST_ROWS, but not a link, which may lead anywhere, up to a folder above. What reads as it
// was shown is not written, so the pane is not drawn again for nothing.
export async function loadTree($: Api, say: Messages, root: string): Promise<Opened> {
  const stat = await $.fs.stat(root).catch(() => undefined)
  if (stat?.kind !== 'dir') return { error: say.notFolder(root) }
  const current = await read($, tree)
  const same = current?.root === root ? current : undefined
  const [listings, info] = await Promise.all([listAll($, root, ['', ...(same?.expanded ?? [])]), gitInfo($, root)])
  const top = listings['']
  if (!top) return { error: say.unreadable(root) }
  const expanded = same ? [...same.expanded] : []
  if (!same) {
    const folders = top.filter(entry => entry.kind === 'dir' && !entry.isLink && !info.ignored.includes(`${entry.name}/`)).map(entry => entry.name)
    const children = await listAll($, root, folders)
    let rows = top.length
    for (const folder of folders) {
      const entries = children[folder]
      if (!entries || rows + entries.length > FIRST_ROWS) continue
      expanded.push(folder)
      listings[folder] = entries
      rows += entries.length
    }
  }
  const state: TreeState = {
    root,
    ...labels(await where($), root),
    ...(info.branch ? { branch: info.branch } : {}),
    expanded,
    full: same?.full ?? [],
    selected: same?.selected ?? '',
    listings,
    badges: info.badges,
    ignored: info.ignored,
  }
  if (JSON.stringify(state) !== JSON.stringify(current)) await update($, tree, () => state)
  schedule.done(await now($))
  lastStatus = info.status
  return { title: state.name, label: state.heading, lines: treeRows(state).rows.length }
}

// Reads the shown folder again: its entries, the opened folders' and Git's marks.
async function reload($: Api, say: Messages): Promise<void> {
  const shown = await read($, tree)
  if (shown) await loadTree($, say, shown.root)
}

// Whether what the tree shows may have moved since it was read: git's status, or what a folder
// shown holds. What git ignores moves with what a folder holds, and is read with the rest.
async function moved($: Api): Promise<boolean> {
  const shown = await read($, tree)
  if (!shown) return false
  const folders = ['', ...shown.expanded]
  const [status, listings] = await Promise.all([runGit($, STATUS, shown.root), listAll($, shown.root, folders)])
  return status !== lastStatus || folders.some(folder => JSON.stringify(listings[folder]) !== JSON.stringify(shown.listings[folder]))
}

// Reads the tree again when it is due: in full when something may have changed it; else git's
// status and the folders shown, and the rest only when either moved.
export async function tickTree($: Api, say: Messages): Promise<void> {
  await schedule.tick(await now($), () => moved($), () => reload($, say))
}

// Opens or closes a folder, and chooses it. A folder opened is read in full at the next tick, as
// what git ignores in it may have come since the last read.
export async function toggleFolder($: Api, path: string): Promise<void> {
  const shown = await read($, tree)
  if (!shown) return
  const isOpen = shown.expanded.includes(path)
  const entries = isOpen || shown.listings[path] ? undefined : await listDir($, join(shown.root, path))
  await update($, tree, current => {
    if (!current || current.root !== shown.root) return current
    return {
      ...current,
      expanded: isOpen ? current.expanded.filter(folder => folder !== path) : [...current.expanded, path],
      listings: entries ? { ...current.listings, [path]: entries } : current.listings,
      selected: path,
    }
  })
  if (!isOpen) schedule.markStale()
}

// Shows a long folder whole.
export async function showAll($: Api, path: string): Promise<void> {
  await update($, tree, current => (current && !current.full.includes(path) ? { ...current, full: [...current.full, path] } : current))
}

// Where the tree view is, for Back.
export async function treeLocation($: Api): Promise<Location | undefined> {
  const shown = await read($, tree)
  return shown ? { view: 'tree', root: shown.root } : undefined
}

// The tree as text, as `tree` prints it.
export async function shownTreeText($: Api, say: Messages): Promise<string | undefined> {
  const shown = await read($, tree)
  return shown ? treeText(shown.name, treeRows(shown).rows, say.more) : undefined
}

// A selection from the tree, headed by the folder; undefined when it is not in the tree.
export async function treeQuote($: Api, say: Messages, selected: string): Promise<Quoted | undefined> {
  const shown = await read($, tree)
  const text = await shownTreeText($, say)
  if (!shown || !text || !locate(text, selected)) return undefined
  return { head: `tree ${shown.heading}`, text: selected }
}

// The tree as a block for the prompt: the folder, then the tree.
export async function treeBlock($: Api, say: Messages): Promise<string | undefined> {
  const shown = await read($, tree)
  const text = await shownTreeText($, say)
  return shown && text ? `tree ${shown.heading}\n${fenced(text)}` : undefined
}

// The chosen folder (else the shown one) as the working directory names it, to mention it.
export async function treeMention($: Api): Promise<string | undefined> {
  const shown = await read($, tree)
  if (!shown) return undefined
  if (!shown.selected) return shown.heading
  return folderLabel(await where($), join(shown.root, shown.selected))
}

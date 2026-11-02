// The tree view: a folder's entries, the folders opened under it, Git's marks and what git
// ignores, read again while shown.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Location, TreeEntry, TreeState } from '../../types'
import { where } from '../find'
import type { Messages } from '../messages'
import type { Opened } from '../nav'
import { statusBadges } from '../pure/git'
import { fenced } from '../pure/markdown'
import { basename, describe, fromHome } from '../pure/paths'
import type { Where } from '../pure/paths'
import { locate } from '../pure/quote'
import { sortEntries, treeRows, treeText } from '../pure/tree'
import { now, rereads, runGit } from '../run'

type Api = EngineInterface

// How many rows the folders opened at first may add up to.
const FIRST_ROWS = 200

// Read and written only in this file (see views/file.ts).
const tree = atom({ plugin: 'peek', key: 'tree' } as const, null, { shape: 'tree-1' })

// The tree is read again every 5 seconds while shown.
const schedule = rereads(5000)

// Forgets what an earlier load of the module was doing.
export function resetTree(): void {
  schedule.reset()
}

// Something may have changed the files (a turn ended, Claude ran a command or edited a file).
export function markTreeStale(): void {
  schedule.markStale()
}

// The tree shown, for a drawing, which a change to it then redraws.
export async function shownTree($: Api): Promise<TreeState | null> {
  return read($, tree)
}

async function listDir($: Api, path: string): Promise<TreeEntry[] | undefined> {
  try {
    const entries = await $.fs.list(path)
    return sortEntries(entries.map(entry => ({ name: entry.name, kind: entry.kind })))
  } catch {
    return undefined
  }
}

// The branch, Git's marks and what git ignores, when `root` is in a repository.
async function gitInfo($: Api, root: string): Promise<{ branch?: string; badges: Record<string, string>; ignored: string[] }> {
  const top = await runGit($, ['rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'], root)
  if (top === undefined) return { badges: {}, ignored: [] }
  const [toplevel = root, branch] = top.split('\n')
  const prefix = root === toplevel ? '' : root.slice(toplevel.length + 1)
  const [status, ignored] = await Promise.all([
    runGit($, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], root),
    runGit($, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], root),
  ])
  return {
    ...(branch ? { branch } : {}),
    badges: status === undefined ? {} : statusBadges(status, prefix),
    ignored: ignored === undefined ? [] : ignored.split('\0').filter(Boolean),
  }
}

// How a folder is labelled: from the home for the header (as pwd would print it), from the
// working directory for a quote's heading and a mention.
function labels(at: Where, root: string): Pick<TreeState, 'label' | 'heading' | 'name'> {
  const heading = root === at.cwd ? './' : `${describe(at, root).label}/`
  return { label: fromHome(at.home, root), heading, name: `${basename(root) || '/'}/` }
}

// The entries of each of `folders` under `root`, listed side by side; a folder that cannot be
// listed is left out.
async function listAll($: Api, root: string, folders: readonly string[]): Promise<TreeState['listings']> {
  const entries = await Promise.all(folders.map(folder => listDir($, `${root}/${folder}`)))
  const listings: TreeState['listings'] = {}
  folders.forEach((folder, i) => {
    const listed = entries[i]
    if (listed) listings[folder] = listed
  })
  return listings
}

// Reads `root` into the tree view, its folders and git side by side. The folder shown again
// keeps what was opened and chosen; a new one opens its smaller folders, as many as fit in
// FIRST_ROWS. What reads as it was shown is not written, so the pane is not drawn again for
// nothing.
export async function loadTree($: Api, say: Messages, root: string): Promise<Opened> {
  const stat = await $.fs.stat(root).catch(() => undefined)
  if (stat?.kind !== 'dir') return { error: say.notFolder(root) }
  const current = await read($, tree)
  const same = current?.root === root ? current : undefined
  const [top, info, opened] = await Promise.all([listDir($, root), gitInfo($, root), same ? listAll($, root, same.expanded) : {}])
  if (!top) return { error: say.unreadable(root) }
  const listings: TreeState['listings'] = { '': top, ...opened }
  const expanded = same ? [...same.expanded] : []
  if (!same) {
    const folders = top.filter(entry => entry.kind === 'dir' && !info.ignored.includes(`${entry.name}/`)).map(entry => entry.name)
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
  return { title: state.name, label: state.heading, lines: treeRows(state).rows.length }
}

// Reads the shown folder again: its entries, the opened folders' and Git's marks.
async function reload($: Api, say: Messages): Promise<void> {
  const shown = await read($, tree)
  if (shown) await loadTree($, say, shown.root)
}

// Reads the tree again when it is due: something may have changed it, or 5 seconds passed.
export async function tickTree($: Api, say: Messages): Promise<void> {
  if (schedule.isDue(await now($))) await schedule.run(() => reload($, say))
}

// Opens or closes a folder, and chooses it.
export async function toggleFolder($: Api, path: string): Promise<void> {
  const shown = await read($, tree)
  if (!shown) return
  const isOpen = shown.expanded.includes(path)
  const entries = isOpen || shown.listings[path] ? undefined : await listDir($, `${shown.root}/${path}`)
  await update($, tree, current => {
    if (!current || current.root !== shown.root) return current
    return {
      ...current,
      expanded: isOpen ? current.expanded.filter(folder => folder !== path) : [...current.expanded, path],
      listings: entries ? { ...current.listings, [path]: entries } : current.listings,
      selected: path,
    }
  })
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
export async function treeQuote($: Api, say: Messages, selected: string): Promise<{ head: string; text: string } | undefined> {
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
  const at = await where($)
  const path = `${shown.root}/${shown.selected}`
  return path === at.cwd ? './' : `${describe(at, path).label}/`
}

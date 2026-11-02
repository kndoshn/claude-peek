// The tree view: a folder's entries, the folders opened under it, Git's marks and what git
// ignores, read again while shown.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Location, TreeState } from '../../types'
import { where } from '../find'
import type { Messages } from '../messages'
import { statusBadges } from '../pure/git'
import { fenced } from '../pure/markdown'
import { basename, describe } from '../pure/paths'
import type { Where } from '../pure/paths'
import { locate } from '../pure/quote'
import { sortEntries, treeRows, treeText } from '../pure/tree'
import type { TreeEntry } from '../pure/tree'
import type { Opened } from './file'

type Api = EngineInterface

// The pane's header line and the gap under it.
const HEADER_ROWS = 2
// How many rows the folders opened at first may add up to.
const FIRST_ROWS = 200
// How often the tree is read again while shown.
const REREAD_MS = 5000
// git without taking the index lock, which a git of Claude's may be holding.
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0' }

// Read and written only in this file (see views/file.ts).
const tree = atom({ plugin: 'peek', key: 'tree' } as const, null, { shape: 'tree-1' })

// When the tree was last read, whether something may have changed it since, and whether a
// read is under way.
let readAt: number | undefined
let isStale = false
let reading = false

// Forgets what an earlier load of the module was doing.
export function resetTree(): void {
  readAt = undefined
  isStale = false
  reading = false
}

// Something may have changed the files (a turn ended, Claude ran a command or edited a file).
export function markTreeStale(): void {
  isStale = true
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
  const run = (argv: string[]) => $.process.run(argv, { cwd: root, env: GIT_ENV }).catch(() => undefined)
  const top = await run(['git', 'rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'])
  if (top?.exitCode !== 0) return { badges: {}, ignored: [] }
  const [toplevel = root, branch] = top.stdout.split('\n')
  const prefix = root === toplevel ? '' : root.slice(toplevel.length + 1)
  const status = await run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  const ignored = await run(['git', 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])
  return {
    ...(branch ? { branch } : {}),
    badges: status?.exitCode === 0 ? statusBadges(status.stdout, prefix) : {},
    ignored: ignored?.exitCode === 0 ? ignored.stdout.split('\0').filter(Boolean) : [],
  }
}

// How a folder is labelled: from the home for the header (as pwd would print it), from the
// working directory for a quote's heading and a mention.
function labels(at: Where, root: string): Pick<TreeState, 'label' | 'heading' | 'name'> {
  const home = at.home
  const label = home && root === home ? '~' : home && root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root
  const heading = root === at.cwd ? './' : `${describe(at, root).label}/`
  return { label, heading, name: `${basename(root) || '/'}/` }
}

// Reads `root` into the tree view. The folder shown again keeps what was opened and chosen; a new
// one opens its smaller folders, as many as fit in FIRST_ROWS.
export async function loadTree($: Api, say: Messages, root: string): Promise<Opened> {
  const stat = await $.fs.stat(root).catch(() => undefined)
  if (stat?.kind !== 'dir') return { error: say.notFolder(root) }
  const top = await listDir($, root)
  if (!top) return { error: say.unreadable(root) }
  const current = await read($, tree)
  const same = current?.root === root ? current : undefined
  const info = await gitInfo($, root)
  const listings: TreeState['listings'] = { '': top }
  const expanded = same ? [...same.expanded] : []
  if (same) {
    for (const folder of same.expanded) {
      const entries = await listDir($, `${root}/${folder}`)
      if (entries) listings[folder] = entries
    }
  } else {
    let rows = top.length
    for (const entry of top) {
      if (entry.kind !== 'dir' || info.ignored.includes(`${entry.name}/`)) continue
      const entries = await listDir($, `${root}/${entry.name}`)
      if (!entries || rows + entries.length > FIRST_ROWS) continue
      expanded.push(entry.name)
      listings[entry.name] = entries
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
  await update($, tree, () => state)
  readAt = await $.clock.now().catch(() => undefined)
  isStale = false
  return { title: state.name, label: state.heading, rows: treeRows(state).rows.length + HEADER_ROWS }
}

// Reads the shown folder again: its entries, the opened folders' and Git's marks.
export async function refreshTree($: Api, say: Messages): Promise<void> {
  if (reading) return
  reading = true
  try {
    const shown = await read($, tree)
    if (shown) await loadTree($, say, shown.root)
  } finally {
    reading = false
  }
}

// Reads the tree again when it is due: something may have changed it, or REREAD_MS passed.
export async function tickTree($: Api, say: Messages): Promise<void> {
  const now = await $.clock.now().catch(() => undefined)
  if (isStale || readAt === undefined || (now !== undefined && now - readAt >= REREAD_MS)) await refreshTree($, say)
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

// A folder's tree as rows and as text, from the listings of the folders opened. Pure.

import type { TreeEntry } from '../../types'

// One row: an entry with the lines that lead to it, its Git mark, whether git ignores it and
// whether it is an open folder; or the row standing for the entries a long folder holds back.
export type TreeRow = {
  path: string
  name: string
  kind: 'file' | 'dir' | 'other' | 'more'
  prefix: string
  badge?: string
  isIgnored: boolean
  isOpen?: boolean
  hidden?: number
}

export type TreeInput = {
  // Each listed folder's entries by its path from the root ('' for the root).
  listings: Readonly<Record<string, readonly TreeEntry[]>>
  expanded: readonly string[]
  // The folders shown whole, past PER_DIR.
  full: readonly string[]
  badges: Readonly<Record<string, string>>
  // What git ignores, from the root; a folder ends in '/'.
  ignored: readonly string[]
}

// How many entries of one folder show before the rest are asked for.
export const PER_DIR = 100
// How many rows one tree shows at most.
export const MAX_ROWS = 1000

// A folder's entries as the tree lists them: folders first, then by name ignoring case, .git
// left out.
export function sortEntries(entries: readonly TreeEntry[]): TreeEntry[] {
  return entries
    .filter(entry => entry.name !== '.git')
    .sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

// Whether git ignores `path`: it, or a folder it is in, is on the list.
function ignoredAt(path: string, kind: TreeEntry['kind'], ignored: readonly string[]): boolean {
  const own = kind === 'dir' ? `${path}/` : path
  return ignored.some(entry => own === entry || (entry.endsWith('/') && own.startsWith(entry)))
}

// The rows of the tree, the folders in `expanded` opened, cut at MAX_ROWS.
export function treeRows(input: TreeInput): { rows: TreeRow[]; isCut: boolean } {
  const rows: TreeRow[] = []
  let isCut = false
  const walk = (dir: string, prefix: string) => {
    const entries = input.listings[dir] ?? []
    const shown = input.full.includes(dir) ? entries : entries.slice(0, PER_DIR)
    const hidden = entries.length - shown.length
    for (const [i, entry] of shown.entries()) {
      if (rows.length >= MAX_ROWS) {
        isCut = true
        return
      }
      const isLast = i === shown.length - 1 && hidden === 0
      const path = dir ? `${dir}/${entry.name}` : entry.name
      const isOpen = entry.kind === 'dir' && input.expanded.includes(path) && input.listings[path] !== undefined
      rows.push({
        path,
        name: entry.name,
        kind: entry.kind,
        prefix: `${prefix}${isLast ? '└── ' : '├── '}`,
        ...(input.badges[path] ? { badge: input.badges[path] } : {}),
        isIgnored: ignoredAt(path, entry.kind, input.ignored),
        ...(entry.kind === 'dir' ? { isOpen } : {}),
      })
      if (isOpen) walk(path, `${prefix}${isLast ? '    ' : '│   '}`)
    }
    if (hidden > 0 && rows.length < MAX_ROWS) {
      rows.push({ path: dir, name: '', kind: 'more', prefix: `${prefix}└── `, isIgnored: false, hidden })
    }
  }
  walk('', '')
  return { rows, isCut }
}

// A row as text: its lines, its name (a folder's with a slash) and its Git mark.
export function rowText(row: TreeRow, more: (hidden: number) => string): string {
  if (row.kind === 'more') return `${row.prefix}${more(row.hidden ?? 0)}`
  return `${row.prefix}${row.name}${row.kind === 'dir' ? '/' : ''}${row.badge ? ` ${row.badge}` : ''}`
}

// The tree as `tree` prints it: the root's name, then a line a row.
export function treeText(rootName: string, rows: readonly TreeRow[], more: (hidden: number) => string): string {
  return [rootName, ...rows.map(row => rowText(row, more))].join('\n')
}

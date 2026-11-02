// Paths: resolving and labelling them, finding the Markdown files a reply named, and ranking
// them against what the person typed. Pure.

import type { SessionMessage } from 'claude-code'

import type { MdFile } from '../../types'

// Where relative and ~/ paths start.
export type Where = { cwd: string; home: string | undefined }

export const MARKDOWN = /\.(md|markdown)$/i
// A file's path inside a reply: up to spaces, quotes, backticks and brackets, with an extension
// that starts with a letter (so a version such as v1.2 is not one) and maybe `:12` or `:12-14`.
const PATH_IN_TEXT = /[^\s`'"()<>[\]{}|,]+\.[A-Za-z][A-Za-z0-9]{0,9}(?::\d+(?:-\d+)?)?(?![\w/])/g
// The tools whose input names a file, and the field that names it.
const FILE_TOOLS: Readonly<Record<string, string>> = {
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function dirname(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), 0)) || '/'
}

// An absolute path with its `.` and `..` segments folded.
export function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

// `path` as an absolute path: as it is, from the home for ~/, else from the working directory.
export function absolute(at: Where, path: string): string {
  if (path.startsWith('/')) return normalize(path)
  if (path.startsWith('~/')) return normalize(`${at.home ?? '~'}${path.slice(1)}`)
  return normalize(`${at.cwd}/${path}`)
}

// An absolute path with its label: relative inside the working directory, from the home with
// ~/ elsewhere under it, else the path itself.
export function describe(at: Where, path: string): MdFile {
  if (path.startsWith(`${at.cwd}/`)) return { path, label: path.slice(at.cwd.length + 1) }
  if (at.home && path.startsWith(`${at.home}/`)) return { path, label: `~${path.slice(at.home.length)}` }
  return { path, label: path }
}

// The files a reply named, the last named first: those its file tools took, then the paths in
// its text, each without the lines after it. URLs are not files.
export function named(message: SessionMessage): string[] {
  const found: string[] = []
  for (const use of message.toolUses) {
    const field = FILE_TOOLS[use.tool]
    const path = field ? use.input[field] : undefined
    if (typeof path === 'string') found.push(path)
  }
  for (const token of message.text.match(PATH_IN_TEXT) ?? []) {
    if (!token.includes('://')) found.push(token.replace(/:\d+(?:-\d+)?$/, ''))
  }
  return found.reverse()
}

// A completion row for a label: the name (a folder's with its slash), and beside it the folder
// it is in when there is one.
export function suggestion(label: string): { text: string; label: string; description?: string } {
  const isDir = label.endsWith('/')
  const bare = isDir ? label.slice(0, -1) : label
  const slash = bare.lastIndexOf('/')
  const name = `${bare.slice(slash + 1)}${isDir ? '/' : ''}`
  if (slash < 0) return { text: label, label: name }
  return { text: label, label: name, description: bare.slice(0, slash) || '/' }
}

// Whether every character of `query` appears in `text` in order, ignoring case.
function fuzzy(query: string, text: string): boolean {
  const haystack = text.toLowerCase()
  let at = 0
  for (const char of query.toLowerCase()) {
    at = haystack.indexOf(char, at)
    if (at < 0) return false
    at += 1
  }
  return true
}

// The labels matching `query`, best first: the query inside the file name, inside the path,
// then loosely in the file name and in the path. Within a rank the given order stays.
export function rank(query: string, labels: readonly string[]): string[] {
  const q = query.toLowerCase()
  const tier = (label: string): number => {
    const name = basename(label.replace(/\/$/, '')).toLowerCase()
    if (name.includes(q)) return 0
    if (label.toLowerCase().includes(q)) return 1
    if (fuzzy(q, name)) return 2
    if (fuzzy(q, label)) return 3
    return 4
  }
  return labels
    .map((label, i) => ({ label, i, t: tier(label) }))
    .filter(x => x.t < 4)
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(x => x.label)
}

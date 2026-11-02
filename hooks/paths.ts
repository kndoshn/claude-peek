// Paths: resolving and labelling them, finding the Markdown files a reply named, and ranking
// them against what the person typed. Pure.

import type { SessionMessage } from 'claude-code'

import type { MdFile } from '../types'

// Where relative and ~/ paths start.
export type Where = { cwd: string; home: string | undefined }

export const MARKDOWN = /\.(md|markdown)$/i
// A path ending in .md inside a reply, stopping at spaces, quotes, backticks and brackets.
const PATH_IN_TEXT = /[^\s`'"()<>[\]{}|,]+\.(?:md|markdown)(?![\w/])/gi
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'Read'])

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

// The .md files a reply named, the last named first: the file_path of its file tools, then the
// paths in its text.
export function named(message: SessionMessage): string[] {
  const found: string[] = []
  for (const use of message.toolUses) {
    const path = use.input.file_path
    if (FILE_TOOLS.has(use.tool) && typeof path === 'string' && MARKDOWN.test(path)) found.push(path)
  }
  found.push(...(message.text.match(PATH_IN_TEXT) ?? []))
  return found.reverse()
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
    const name = basename(label).toLowerCase()
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

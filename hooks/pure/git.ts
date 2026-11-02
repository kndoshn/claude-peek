// Reading git's output. Pure.

import type { GitStatus, LogLine, PatchFile } from '../../types'

// A file in `git status --porcelain=v2 -z`: what kind of entry it is (1 changed, 2 renamed or
// copied, u unmerged, ? untracked), its marks (X staged, Y not; ?? untracked) and its path from
// the top of the repository.
type StatusFile = { kind: '1' | '2' | 'u' | '?'; xy: string; path: string }

// `git status --porcelain=v2 -z` as its header lines (`# branch.head main` as branch.head: main)
// and its files.
function readStatus(output: string): { headers: Record<string, string>; files: StatusFile[] } {
  const headers: Record<string, string> = {}
  const files: StatusFile[] = []
  const parts = output.split('\0')
  // The path follows a set number of fields, and may hold spaces.
  const after = (entry: string, fields: number) => entry.split(' ').slice(fields).join(' ')
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i] ?? ''
    const xy = entry.slice(2, 4)
    if (entry.startsWith('# ')) {
      const [key = '', ...value] = entry.slice(2).split(' ')
      headers[key] = value.join(' ')
    } else if (entry.startsWith('1 ')) {
      files.push({ kind: '1', xy, path: after(entry, 8) })
    } else if (entry.startsWith('2 ')) {
      files.push({ kind: '2', xy, path: after(entry, 9) })
      // The path it came from is the next entry.
      i += 1
    } else if (entry.startsWith('u ')) {
      files.push({ kind: 'u', xy, path: after(entry, 10) })
    } else if (entry.startsWith('? ')) {
      files.push({ kind: '?', xy: '??', path: entry.slice(2) })
    }
  }
  return { headers, files }
}

// The marks of `git status --porcelain=v2 -z` by path from `prefix` (the shown folder within
// the repository, '' for its top): M changed, A added, D deleted, R renamed, ? untracked, and
// • on each folder that holds a mark. Paths outside the folder are left out.
export function statusBadges(output: string, prefix: string): Record<string, string> {
  const badges: Record<string, string> = {}
  for (const { xy, path: written } of readStatus(output).files) {
    const path = written.replace(/\/$/, '')
    if (prefix && !path.startsWith(`${prefix}/`)) continue
    const relative = prefix ? path.slice(prefix.length + 1) : path
    badges[relative] = xy === '??' ? '?' : xy.includes('A') ? 'A' : xy.includes('D') ? 'D' : xy[0] === 'R' ? 'R' : 'M'
    const segments = relative.split('/')
    for (let depth = segments.length - 1; depth > 0; depth -= 1) {
      const folder = segments.slice(0, depth).join('/')
      badges[folder] ??= '•'
    }
  }
  return badges
}

// `git status --porcelain=v2 --branch --show-stash -z` as a status.
export function parseStatus(output: string): GitStatus {
  const { headers, files } = readStatus(output)
  const head = headers['branch.head']
  const oid = headers['branch.oid']
  const upstream = headers['branch.upstream']
  const [ahead = '+0', behind = '-0'] = (headers['branch.ab'] ?? '').split(' ')
  const status: GitStatus = {
    branch: head === undefined || head === '(detached)' ? null : head,
    oid: oid === undefined || oid === '(initial)' ? null : oid,
    ...(upstream === undefined ? {} : { upstream }),
    ahead: Number(ahead.slice(1)) || 0,
    behind: Number(behind.slice(1)) || 0,
    stash: Number(headers.stash) || 0,
    staged: [],
    unstaged: [],
    untracked: [],
  }
  for (const { kind, xy, path } of files) {
    if (kind === '?') {
      status.untracked.push(path)
    } else if (kind === 'u') {
      status.unstaged.push({ path, mark: 'U' })
    } else {
      if (xy[0] && xy[0] !== '.') status.staged.push({ path, mark: xy[0] })
      if (xy[1] && xy[1] !== '.') status.unstaged.push({ path, mark: xy[1] })
    }
  }
  return status
}

// `git log --graph --format=%x1f%h%x1f%D%x1f%s%x1f%ar` as its lines.
export function parseLog(output: string): LogLine[] {
  return output
    .replace(/\n$/, '')
    .split('\n')
    .filter(line => line !== '')
    .map(line => {
      const [graph = '', hash, refs = '', subject = '', age = ''] = line.split('\u001f')
      return hash ? { graph, commit: { hash, refs, subject, age } } : { graph }
    })
}

// A path git quotes in a patch: one that holds a quote, a backslash or a control character.
const QUOTED = String.raw`"(?:[^"\\]|\\.)*"`
// `diff --git a/<path> b/<path>`, each side maybe quoted.
const HEADER = new RegExp(`^diff --git (${QUOTED}|a/.*) (${QUOTED}|b/.*)$`)

// What a backslash and the letter after it stand for in a path git quotes.
const ESCAPES: Readonly<Record<string, string>> = { a: '\u0007', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r' }

// A path as git writes it on `side` of a patch, without its `a/` or `b/`; undefined for none
// (/dev/null). A quoted one reads as it is, a control character too, which a drawing shows as
// its picture. A byte past ASCII is written in octal only with core.quotePath on, which peek
// turns off, so it stays as written.
function unquote(written: string, side: 'a' | 'b'): string | undefined {
  const quoted = written.startsWith('"') && written.endsWith('"') && written.length > 1
  const path = quoted
    ? written.slice(1, -1).replace(/\\([0-7]{3}|.)/g, (escape, code: string) => {
        if (code.length < 3) return ESCAPES[code] ?? code
        const byte = parseInt(code, 8)
        return byte < 0x80 ? String.fromCharCode(byte) : escape
      })
    : written
  return path.startsWith(`${side}/`) ? path.slice(2) : undefined
}

// A commit's patch split by file.
export function splitPatch(patch: string): PatchFile[] {
  const files: PatchFile[] = []
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue
    const lines = chunk.replace(/\n$/, '').split('\n')
    const side = (prefix: string, which: 'a' | 'b') => {
      const line = lines.find(found => found.startsWith(prefix))
      return line === undefined ? undefined : unquote(line.slice(prefix.length), which)
    }
    const named = HEADER.exec(lines[0] ?? '')?.[2]
    const path = side('+++ ', 'b') ?? side('--- ', 'a') ?? (named === undefined ? undefined : unquote(named, 'b')) ?? ''
    const first = lines.findIndex(line => line.startsWith('@@'))
    files.push({
      path,
      hunks: first < 0 ? '' : `${lines.slice(first).join('\n')}\n`,
      note: first < 0 ? lines.slice(1).filter(line => !/^(index|---|\+\+\+) /.test(line)).join('\n') : '',
    })
  }
  return files
}

// A history line as text: its graph, then the commit's hash, references, subject and age.
export function logLineText(line: LogLine): string {
  if (!line.commit) return line.graph
  const { hash, refs, subject, age } = line.commit
  return `${line.graph} ${hash}${refs ? ` (${refs})` : ''} ${subject} ${age}`
}

// Reading git's output. Pure.

// The marks of `git status --porcelain=v1 -z` by path from `prefix` (the shown folder within
// the repository, '' for its top): M changed, A added, D deleted, R renamed, ? untracked, and
// • on each folder that holds a mark. Paths outside the folder are left out.
export function statusBadges(output: string, prefix: string): Record<string, string> {
  const badges: Record<string, string> = {}
  const parts = output.split('\0')
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i] ?? ''
    if (entry.length < 4) continue
    const xy = entry.slice(0, 2)
    // A rename or copy is followed by the path it came from.
    if (xy[0] === 'R' || xy[0] === 'C') i += 1
    const path = entry.slice(3).replace(/\/$/, '')
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

export type GitFile = { path: string; mark: string }

export type GitStatus = {
  branch: string | null
  oid: string | null
  upstream?: string
  ahead: number
  behind: number
  stash: number
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: string[]
}

// `git status --porcelain=v2 --branch --show-stash -z`: the branch (null when detached), its
// commit (null before the first), the upstream and how far ahead and behind, the stash count,
// and the files staged, changed but not staged (conflicts marked U), and untracked.
export function parseStatus(output: string): GitStatus {
  const status: GitStatus = { branch: null, oid: null, ahead: 0, behind: 0, stash: 0, staged: [], unstaged: [], untracked: [] }
  const parts = output.split('\0')
  const after = (entry: string, fields: number) => entry.split(' ').slice(fields).join(' ')
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i] ?? ''
    if (entry.startsWith('# branch.oid ')) {
      const oid = entry.slice('# branch.oid '.length)
      status.oid = oid === '(initial)' ? null : oid
    } else if (entry.startsWith('# branch.head ')) {
      const head = entry.slice('# branch.head '.length)
      status.branch = head === '(detached)' ? null : head
    } else if (entry.startsWith('# branch.upstream ')) {
      status.upstream = entry.slice('# branch.upstream '.length)
    } else if (entry.startsWith('# branch.ab ')) {
      const [, ahead = '+0', behind = '-0'] = entry.split(' ').slice(1)
      status.ahead = Number(ahead.slice(1)) || 0
      status.behind = Number(behind.slice(1)) || 0
    } else if (entry.startsWith('# stash ')) {
      status.stash = Number(entry.slice('# stash '.length)) || 0
    } else if (entry.startsWith('1 ') || entry.startsWith('2 ')) {
      const xy = entry.slice(2, 4)
      // An ordinary change has its path after 8 fields; a rename or copy after 9, then the path
      // it came from as the next entry.
      const path = entry.startsWith('1 ') ? after(entry, 8) : after(entry, 9)
      if (entry.startsWith('2 ')) i += 1
      if (xy[0] && xy[0] !== '.') status.staged.push({ path, mark: xy[0] })
      if (xy[1] && xy[1] !== '.') status.unstaged.push({ path, mark: xy[1] })
    } else if (entry.startsWith('u ')) {
      status.unstaged.push({ path: after(entry, 10), mark: 'U' })
    } else if (entry.startsWith('? ')) {
      status.untracked.push(entry.slice(2))
    }
  }
  return status
}

// A line of `git log --graph --format=%x1f%h%x1f%D%x1f%s%x1f%ar`: the graph, then the commit when
// the line has one.
export type LogLine = { graph: string; commit?: { hash: string; refs: string; subject: string; age: string } }

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

// A commit's patch split by file: each file's path and its hunks, or what git says in their place
// (a binary file, a mode change).
export function splitPatch(patch: string): { path: string; hunks: string; note: string }[] {
  const files: { path: string; hunks: string; note: string }[] = []
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue
    const lines = chunk.replace(/\n$/, '').split('\n')
    const plus = lines.find(line => line.startsWith('+++ b/'))?.slice(6)
    const minus = lines.find(line => line.startsWith('--- a/'))?.slice(6)
    const named = /^diff --git a\/(.*) b\/(.*)$/.exec(lines[0] ?? '')
    const path = plus ?? minus ?? named?.[2] ?? ''
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

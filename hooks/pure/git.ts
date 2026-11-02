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

// Pure helpers over paths and text, apart from the engine.

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

// The lines of a text, a final newline ending the last line rather than starting another.
export function lines(text: string): string[] {
  return text === '' ? [] : text.replace(/\n$/, '').split('\n')
}

// The selected text as Markdown quote lines.
export function quote(text: string): string {
  return text
    .replace(/\s+$/, '')
    .split('\n')
    .map(line => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n')
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

// A line reduced to its letters and digits, a link's target dropped, so the source and its
// rendering compare equal: no markers, emphasis, table rules or bullets.
function bare(line: string): string {
  return line
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\]\([^)]*\)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

// The source lines, 1-based and inclusive, that the rendered text `selected` was taken from, or
// undefined when it cannot be found. Each selected line after the first goes on the same source
// line (the pane wrapped it) or starts the next source line that has any text.
export function locate(source: string, selected: string): [number, number] | undefined {
  const lines = source.split('\n').map(bare)
  const wanted = selected.split('\n').map(bare).filter(Boolean)
  const [first, ...rest] = wanted
  if (first === undefined) return undefined
  for (let start = 0; start < lines.length; start += 1) {
    const from = lines[start]?.indexOf(first) ?? -1
    if (from < 0) continue
    let line = start
    let end = from + first.length
    const found = rest.every(part => {
      const same = lines[line]?.indexOf(part, end) ?? -1
      if (same >= 0) {
        end = same + part.length
        return true
      }
      let next = line + 1
      while (next < lines.length && lines[next] === '') next += 1
      if (!lines[next]?.startsWith(part)) return false
      line = next
      end = part.length
      return true
    })
    if (found) return [start + 1, line + 1]
  }
  return undefined
}

// A selection copied from the numbered source view, its line numbers taken off: the text and
// the lines it spans, or undefined when the numbers are not that view's. They are when each
// numbered row runs on by one from the last and holds what that line of the source holds;
// a row without a number goes on the row above, wrapped.
export function ungutter(source: string, selected: string): { text: string; lines: [number, number] } | undefined {
  const sourceLines = source.split('\n').map(bare)
  const rows = selected.replace(/\s+$/, '').split('\n')
  const kept: string[] = []
  let first: number | undefined
  let last: number | undefined
  for (const row of rows) {
    const numbered = /^\s*(\d+)(?:\s*[│┃|]\s?|\s+|$)(.*)$/.exec(row)
    if (numbered) {
      const n = Number(numbered[1])
      const text = numbered[2] ?? ''
      if (last !== undefined && n !== last + 1) return undefined
      if (!sourceLines[n - 1]?.includes(bare(text))) return undefined
      first ??= n
      last = n
      kept.push(text)
    } else {
      if (last === undefined) return undefined
      const text = row.trim()
      if (!sourceLines[last - 1]?.includes(bare(text))) return undefined
      kept.push(text)
    }
  }
  if (first === undefined || last === undefined) return undefined
  return { text: kept.join('\n'), lines: [first, last] }
}

export type Change = { kind: ' ' | '-' | '+'; line: string }

const keep = (line: string): Change => ({ kind: ' ', line })
const remove = (line: string): Change => ({ kind: '-', line })
const add = (line: string): Change => ({ kind: '+', line })

// Past this many removed and added lines the changed middle is shown replaced whole, which
// bounds the diff's time and memory.
const MAX_EDITS = 1000

// The line changes that turn `before` into `after`, as few as there can be (Myers' O(ND)
// algorithm over the lines between the common head and tail), removals first within each run.
export function diff(before: string, after: string): Change[] {
  const a = lines(before)
  const b = lines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const x = a.slice(head, a.length - tail)
  const y = b.slice(head, b.length - tail)
  const middle = shortestEdit(x, y) ?? [...x.map(remove), ...y.map(add)]
  return [...a.slice(0, head).map(keep), ...removalsFirst(middle), ...a.slice(a.length - tail).map(keep)]
}

// The shortest edit from `x` to `y`, or undefined past MAX_EDITS.
function shortestEdit(x: readonly string[], y: readonly string[]): Change[] | undefined {
  const n = x.length
  const m = y.length
  if (n === 0 || m === 0) return [...x.map(remove), ...y.map(add)]
  // Compare lines by number rather than by text.
  const ids = new Map<string, number>()
  const id = (line: string) => {
    let found = ids.get(line)
    if (found === undefined) {
      found = ids.size
      ids.set(line, found)
    }
    return found
  }
  const xs = Int32Array.from(x, id)
  const ys = Int32Array.from(y, id)
  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  // v[offset + k]: the furthest x reached on diagonal k (x - y = k).
  const v = new Int32Array(2 * max + 3)
  // trace[d]: v over diagonals -d-1 .. d+1 before the d-th step, to walk the path back.
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
      let px = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
      let py = px - k
      while (px < n && py < m && xs[px] === ys[py]) {
        px += 1
        py += 1
      }
      v[offset + k] = px
      if (px >= n && py >= m) return walkBack(x, y, trace)
    }
  }
  return undefined
}

function walkBack(x: readonly string[], y: readonly string[], trace: readonly Int32Array[]): Change[] {
  const out: Change[] = []
  let px = x.length
  let py = y.length
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const at = (k: number) => trace[d]?.[k + d + 1] ?? 0
    const k = px - py
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (px > prevX && py > prevY) {
      out.push(keep(x[px - 1] ?? ''))
      px -= 1
      py -= 1
    }
    if (d > 0) out.push(px === prevX ? add(y[py - 1] ?? '') : remove(x[px - 1] ?? ''))
    px = prevX
    py = prevY
  }
  return out.reverse()
}

// Each run of changes with its removals before its additions, as a unified diff reads.
function removalsFirst(changes: readonly Change[]): Change[] {
  const out: Change[] = []
  let run: Change[] = []
  const flush = () => {
    out.push(...run.filter(c => c.kind === '-'), ...run.filter(c => c.kind === '+'))
    run = []
  }
  for (const change of changes) {
    if (change.kind === ' ') {
      flush()
      out.push(change)
    } else run.push(change)
  }
  flush()
  return out
}

// How many lines the changes add and remove.
export function count(changes: readonly Change[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const change of changes) {
    if (change.kind === '+') added += 1
    else if (change.kind === '-') removed += 1
  }
  return { added, removed }
}

// The changes as unified-diff hunks with `context` lines around each, or '' when none.
export function hunks(changes: readonly Change[], context = 3): string {
  // oldAt[i], newAt[i]: the old and new lines before changes[i].
  const oldAt = [0]
  const newAt = [0]
  changes.forEach((c, i) => {
    oldAt.push((oldAt[i] ?? 0) + (c.kind === '+' ? 0 : 1))
    newAt.push((newAt[i] ?? 0) + (c.kind === '-' ? 0 : 1))
  })
  const groups: [number, number][] = []
  changes.forEach((c, i) => {
    if (c.kind === ' ') return
    const group = groups[groups.length - 1]
    if (group && i - group[1] <= context * 2 + 1) group[1] = i
    else groups.push([i, i])
  })
  return groups
    .map(([from, to]) => {
      const start = Math.max(0, from - context)
      const end = Math.min(changes.length, to + context + 1)
      const oldCount = (oldAt[end] ?? 0) - (oldAt[start] ?? 0)
      const newCount = (newAt[end] ?? 0) - (newAt[start] ?? 0)
      const oldStart = (oldAt[start] ?? 0) + (oldCount === 0 ? 0 : 1)
      const newStart = (newAt[start] ?? 0) + (newCount === 0 ? 0 : 1)
      const body = changes.slice(start, end).map(c => `${c.kind}${c.line}\n`)
      return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${body.join('')}`
    })
    .join('')
}

// The file: href and path of a relative link target that names a Markdown file, resolved from
// `dir`, or undefined for any other target (a URL, an anchor, a root path, another file).
function markdownTarget(target: string, dir: string): { href: string; path: string } | undefined {
  const written = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
  if (/^[a-z][a-z0-9+.-]*:/i.test(written) || written.startsWith('#') || written.startsWith('/')) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(written.replace(/#.*$/, ''))
  } catch {
    return undefined
  }
  if (!/\.(md|markdown)$/i.test(decoded)) return undefined
  const path = normalize(`${dir}/${decoded}`)
  return { href: `file://${encodeURI(path)}`, path }
}

// Relative links to Markdown files (inline, in angle brackets, or by a reference definition)
// turned into file: links the pane answers, resolved from `dir`; links in code, images and
// other targets left as written. Returns the text and each new link's path by its href.
export function linkify(markdown: string, dir: string): { text: string; links: Map<string, string> } {
  const links = new Map<string, string>()
  const answer = (target: string) => {
    const found = markdownTarget(target, dir)
    if (found) links.set(found.href, found.path)
    return found?.href
  }
  const inline = /(!?)\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(\s+"[^"]*")?\s*\)/g
  const definition = /^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]*>|\S+)(.*)$/
  const rewrite = (segment: string) =>
    segment.replace(inline, (whole, bang: string, label: string, target: string, title: string | undefined) => {
      const href = bang ? undefined : answer(target)
      return href ? `[${label}](${href}${title ?? ''})` : whole
    })
  let fence: string | undefined
  const out = markdown.split('\n').map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
      return line
    }
    if (marker) {
      fence = marker
      return line
    }
    const defined = definition.exec(line)
    if (defined) {
      const href = answer(defined[2] ?? '')
      return href ? `${defined[1]}${href}${defined[3]}` : line
    }
    // Leave inline code spans alone.
    return line
      .split(/(`+[^`]*`+)/)
      .map(part => (part.startsWith('`') ? part : rewrite(part)))
      .join('')
  })
  return { text: out.join('\n'), links }
}

// YAML front matter at the top drawn as a YAML code block rather than a rule and a paragraph.
export function frontMatter(markdown: string): string {
  const found = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown)
  if (!found) return markdown
  return `\`\`\`yaml\n${found[1]}\n\`\`\`\n${markdown.slice(found[0].length)}`
}

// The text cut to at most `limit` characters after a line (for a diff, `unit` '\n@@' cuts after
// a hunk), and whether it was cut.
export function clip(text: string, limit: number, unit = '\n'): { text: string; isCut: boolean } {
  if (text.length <= limit) return { text, isCut: false }
  const end = text.lastIndexOf(unit, limit - 1)
  return { text: text.slice(0, end > 0 ? end + 1 : limit), isCut: true }
}

// `label:12-14`, `label:12`, or the label alone when the lines are not known.
export function cite(label: string, lines: [number, number] | undefined): string {
  if (!lines) return label
  const [start, end] = lines
  return start === end ? `${label}:${start}` : `${label}:${start}-${end}`
}

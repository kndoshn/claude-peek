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

// The line changes that turn `before` into `after`: the longest common run of lines kept, the
// rest removed and added. Past a size the middle is compared as one block.
export function diff(before: string, after: string): Change[] {
  const a = lines(before)
  const b = lines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const x = a.slice(head, a.length - tail)
  const y = b.slice(head, b.length - tail)
  const keep = (line: string): Change => ({ kind: ' ', line })
  const middle: Change[] = []
  if (x.length * y.length > 1_000_000) {
    middle.push(...x.map((line): Change => ({ kind: '-', line })), ...y.map((line): Change => ({ kind: '+', line })))
  } else {
    // lcs[i][j]: the longest common run of x[i..] and y[j..].
    const width = y.length + 1
    const lcs = new Uint32Array((x.length + 1) * width)
    for (let i = x.length - 1; i >= 0; i -= 1) {
      for (let j = y.length - 1; j >= 0; j -= 1) {
        lcs[i * width + j] =
          x[i] === y[j] ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0)
      }
    }
    let i = 0
    let j = 0
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        middle.push(keep(x[i] ?? ''))
        i += 1
        j += 1
      } else if (j < y.length && (i === x.length || (lcs[i * width + j + 1] ?? 0) >= (lcs[(i + 1) * width + j] ?? 0))) {
        middle.push({ kind: '+', line: y[j] ?? '' })
        j += 1
      } else {
        middle.push({ kind: '-', line: x[i] ?? '' })
        i += 1
      }
    }
    // Removals first within each run of changes, as a unified diff reads.
    for (let k = 0; k < middle.length; ) {
      let end = k
      while (end < middle.length && middle[end]?.kind !== ' ') end += 1
      const run = middle.slice(k, end)
      middle.splice(k, run.length, ...run.filter(c => c.kind === '-'), ...run.filter(c => c.kind === '+'))
      k = end + 1
    }
  }
  return [...a.slice(0, head).map(keep), ...middle, ...a.slice(a.length - tail).map(keep)]
}

// The changes as unified-diff hunks with `context` lines around each, or '' when none.
export function hunks(changes: readonly Change[], context = 3): string {
  const changed = changes.flatMap((c, i) => (c.kind === ' ' ? [] : [i]))
  const groups: [number, number][] = []
  for (const i of changed) {
    const group = groups[groups.length - 1]
    if (group && i - group[1] <= context * 2 + 1) group[1] = i
    else groups.push([i, i])
  }
  return groups
    .map(([from, to]) => {
      const start = Math.max(0, from - context)
      const end = Math.min(changes.length, to + context + 1)
      const before = changes.slice(0, start)
      const body = changes.slice(start, end)
      const oldBefore = before.filter(c => c.kind !== '+').length
      const newBefore = before.filter(c => c.kind !== '-').length
      const oldCount = body.filter(c => c.kind !== '+').length
      const newCount = body.filter(c => c.kind !== '-').length
      const oldStart = oldCount === 0 ? oldBefore : oldBefore + 1
      const newStart = newCount === 0 ? newBefore : newBefore + 1
      return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${body.map(c => `${c.kind}${c.line}\n`).join('')}`
    })
    .join('')
}

// Relative links to Markdown files turned into file: links the pane answers, resolved from
// `dir`; links in code, images, anchors and other files left as written. Returns the text and
// each new link's target path by its href.
export function linkify(markdown: string, dir: string): { text: string; links: Map<string, string> } {
  const links = new Map<string, string>()
  const link = /(!?)\[([^\]]*)\]\(\s*([^)\s]+)(\s+"[^"]*")?\s*\)/g
  const rewrite = (segment: string) =>
    segment.replace(link, (whole, bang: string, label: string, target: string, title: string | undefined) => {
      if (bang || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return whole
      const file = target.replace(/#.*$/, '')
      let decoded: string
      try {
        decoded = decodeURIComponent(file)
      } catch {
        return whole
      }
      if (!/\.(md|markdown)$/i.test(decoded)) return whole
      const path = normalize(`${dir}/${decoded}`)
      const href = `file://${encodeURI(path)}`
      links.set(href, path)
      return `[${label}](${href}${title ?? ''})`
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

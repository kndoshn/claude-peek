// Pure helpers over paths and text, apart from the engine.

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
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

// `label:12-14`, `label:12`, or the label alone when the lines are not known.
export function cite(label: string, lines: [number, number] | undefined): string {
  if (!lines) return label
  const [start, end] = lines
  return start === end ? `${label}:${start}` : `${label}:${start}-${end}`
}

// Quoting a selection: finding the source lines a rendered or numbered selection came from and
// writing it as a quote headed by its file and lines. Pure.

// A selection to quote, and the heading that says where it came from.
export type Quoted = { head: string; text: string }

// A word as a POSIX shell reads it back: left as it is when it holds only characters the shell
// takes literally, else in single quotes.
export function shellWord(word: string): string {
  return /^[\w./@%+=:,-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`
}

// The selected text as Markdown quote lines.
export function quote(text: string): string {
  return text
    .replace(/\s+$/, '')
    .split('\n')
    .map(line => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n')
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

// `label:12-14`, `label:12`, or the label alone when the lines are not known.
export function cite(label: string, lines: [number, number] | undefined): string {
  if (!lines) return label
  const [start, end] = lines
  return start === end ? `${label}:${start}` : `${label}:${start}-${end}`
}

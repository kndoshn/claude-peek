// Line diffs: the changes between two texts and their unified-diff hunks. Pure.

// The lines of a text, a final newline ending the last line rather than starting another.
export function lines(text: string): string[] {
  return text === '' ? [] : text.replace(/\n$/, '').split('\n')
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

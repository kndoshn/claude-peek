import { expect, test } from 'claude-code/testing'

import { diff, hunks, linkify } from '../hooks/text'
import type { Change } from '../hooks/text'

// A small deterministic generator, so a failure repeats.
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

// Lines drawn from a few words, so that runs repeat and the diff has choices to make.
function text(next: () => number, count: number): string {
  return Array.from({ length: count }, () => ['a', 'b', 'c', 'd'][Math.floor(next() * 4)]).join('\n')
}

// The length of the longest common run of lines: the reference a minimal diff is held to.
function lcs(a: string[], b: string[]): number {
  const row = new Array<number>(b.length + 1).fill(0)
  for (const x of a) {
    let diagonal = 0
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0
      row[j] = x === b[j - 1] ? diagonal + 1 : Math.max(above, row[j - 1] ?? 0)
      diagonal = above
    }
  }
  return row[b.length] ?? 0
}

const split = (s: string) => (s === '' ? [] : s.split('\n'))
const side = (changes: Change[], drop: '-' | '+') => changes.filter(c => c.kind !== drop).map(c => c.line)

test('the diff turns one text into the other with the fewest changes', () => {
  const next = random(42)
  for (let round = 0; round < 200; round += 1) {
    const before = text(next, Math.floor(next() * 12))
    const after = text(next, Math.floor(next() * 12))
    const changes = diff(before, after)
    expect(side(changes, '+')).toEqual(split(before))
    expect(side(changes, '-')).toEqual(split(after))
    const edits = changes.filter(c => c.kind !== ' ').length
    expect(edits).toBe(split(before).length + split(after).length - 2 * lcs(split(before), split(after)))
  }
})

test('the diff puts removals before additions within a run of changes', () => {
  expect(diff('a\nx\nb', 'a\ny\nb').map(c => `${c.kind}${c.line}`)).toEqual([' a', '-x', '+y', ' b'])
})

test('a long file changed at both ends shows only the changed lines', () => {
  const before = Array.from({ length: 3000 }, (_, i) => `line ${i}`)
  const after = ['new first', ...before.slice(1, -1), 'new last']
  const changes = diff(before.join('\n'), after.join('\n'))
  expect(changes.filter(c => c.kind !== ' ').length).toBe(4)
  expect(hunks(changes).match(/^@@ .* @@$/gm)).toEqual(['@@ -1,4 +1,4 @@', '@@ -2997,4 +2997,4 @@'])
})

test('a diff past the edit limit still turns one text into the other', () => {
  const before = Array.from({ length: 2500 }, (_, i) => `old ${i}`).join('\n')
  const after = Array.from({ length: 2500 }, (_, i) => `new ${i}`).join('\n')
  const changes = diff(before, after)
  expect(side(changes, '+')).toEqual(split(before))
  expect(side(changes, '-')).toEqual(split(after))
})

test('links in angle brackets and reference definitions to Markdown files are answered', () => {
  const { text: out, links } = linkify('[a](<my notes.md>)\n\nSee [b][ref].\n\n[ref]: ./sub/b.md "B"\n[web]: https://example.com', '/d')
  expect(out).toBe('[a](file:///d/my%20notes.md)\n\nSee [b][ref].\n\n[ref]: file:///d/sub/b.md "B"\n[web]: https://example.com')
  expect([...links]).toEqual([
    ['file:///d/my%20notes.md', '/d/my notes.md'],
    ['file:///d/sub/b.md', '/d/sub/b.md'],
  ])
})

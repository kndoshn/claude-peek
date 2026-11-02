import { expect, test } from 'claude-code/testing'

import { diff, hunks } from '../hooks/pure/diff'
import { clip, fenced, frontMatter, linkify } from '../hooks/pure/markdown'
import { absolute, closest, describe, dirname, join, named, normalize, rank } from '../hooks/pure/paths'
import { cite, locate, quote, ungutter } from '../hooks/pure/quote'
import { parseTarget } from '../hooks/pure/target'
import { clean, dropShellNoise, visible } from '../hooks/pure/terminal'
import { logLineText, parseLog, parseStatus, splitPatch, statusBadges } from '../hooks/pure/git'
import { sortEntries, treeRows, treeText } from '../hooks/pure/tree'
import type { Change } from '../hooks/pure/diff'

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

const at = { cwd: '/proj', home: '/home/me' }

test('paths resolve from the working directory or the home and fold dots', () => {
  expect(absolute(at, './docs/../a.md')).toBe('/proj/a.md')
  expect(absolute(at, '~/n/b.md')).toBe('/home/me/n/b.md')
  expect(absolute(at, '~')).toBe('/home/me')
  expect(absolute(at, '~me')).toBe('/proj/~me')
  expect(absolute(at, '/x//y/./z.md')).toBe('/x/y/z.md')
  expect(normalize('/a/../../b')).toBe('/b')
  expect(dirname('/a.md')).toBe('/')
  expect(dirname('/d/a.md')).toBe('/d')
  expect(join('/proj', 'docs/a.md')).toBe('/proj/docs/a.md')
  expect(join('/', 'etc')).toBe('/etc')
})

test('a path is labelled from the working directory, else from the home, else in full', () => {
  expect(describe(at, '/proj/docs/a.md').label).toBe('docs/a.md')
  expect(describe(at, '/home/me/n/b.md').label).toBe('~/n/b.md')
  expect(describe(at, '/etc/c.md').label).toBe('/etc/c.md')
  // A sibling whose name starts with the working directory's is not inside it.
  expect(describe(at, '/project/d.md').label).toBe('/project/d.md')
})

test('a reply names files by its file tools and in its text, the last named first', () => {
  const message = {
    role: 'assistant' as const,
    text: 'See `docs/a.md`, src/b.ts:12-14 and (c.markdown), e.g. v1.2 at https://example.com/x.html.',
    toolUses: [
      { tool_use_id: '1', tool: 'Write', input: { file_path: '/p/w.md' } },
      { tool_use_id: '2', tool: 'Read', input: { file_path: '/p/r.json' } },
      { tool_use_id: '3', tool: 'Bash', input: { command: 'cat z.md' } },
    ],
  }
  // A URL and a version are not files; words that only look like one (e.g) are dropped later,
  // when they are not on disk.
  expect(named(message)).toEqual(['e.g', 'c.markdown', 'src/b.ts', 'docs/a.md', '/p/r.json', '/p/w.md'])
})

test('ranking puts a name match before a path match before loose ones, and drops the rest', () => {
  const labels = ['docs/setup.md', 'set/up/readme.md', 'notes/s-e-t-u-p.md', 'other.md']
  expect(rank('setup', labels)).toEqual(['docs/setup.md', 'notes/s-e-t-u-p.md', 'set/up/readme.md'])
  expect(rank('SETUP', ['docs/setup.md'])).toEqual(['docs/setup.md'])
})

test('the closest label holds the query as it was typed, in its name or its path, never loosely', () => {
  expect(closest('setup', ['notes/s-e-t-u-p.md', 'docs/setup.md'])).toBe('docs/setup.md')
  expect(closest('SETUP', ['notes/setup/a.md'])).toBe('notes/setup/a.md')
  expect(closest('tree', ['kabutan-chart-extension/', 'notes/s-e-t-u-p.md'])).toBeUndefined()
  expect(closest('x', [])).toBeUndefined()
})

test('a quote marks every line and leaves blank lines bare', () => {
  expect(quote('a\n\n  b\n\n')).toBe('> a\n>\n>   b')
  expect(cite('a.md', [3, 3])).toBe('a.md:3')
  expect(cite('a.md', [3, 5])).toBe('a.md:3-5')
  expect(cite('a.md', undefined)).toBe('a.md')
})

test('a rendered selection is found in its source through the Markdown around it', () => {
  const source = '# Title\n\n| a | b |\n|---|---|\n| one | **two** |\n\n> quoted [link](x.md)\n'
  expect(locate(source, '│ one │ two │')).toEqual([5, 5])
  expect(locate(source, 'Title')).toEqual([1, 1])
  expect(locate(source, 'quoted link')).toEqual([7, 7])
  expect(locate(source, '   ')).toBeUndefined()
})

test('numbers are taken off a selection only when they run on and match the source', () => {
  const source = 'a\nlong line here\nc\n'
  expect(ungutter(source, '2 │ long line\n    here\n3 │ c')).toEqual({ text: 'long line\nhere\nc', lines: [2, 3] })
  expect(ungutter(source, '2 long line here\n4 c')).toBeUndefined()
  expect(ungutter(source, '3 things')).toBeUndefined()
  expect(ungutter(source, 'here\n3 c')).toBeUndefined()
})

test('front matter becomes a YAML block only at the very top', () => {
  expect(frontMatter('---\na: 1\n---\nbody')).toBe('```yaml\na: 1\n```\nbody')
  expect(frontMatter('text\n---\na: 1\n---\n')).toBe('text\n---\na: 1\n---\n')
  // A byte order mark before it, as some editors write, is no text.
  expect(frontMatter('\ufeff---\na: 1\n---\nbody')).toBe('```yaml\na: 1\n```\nbody')
})

test('a cut ends after a whole line, or for a diff after a whole hunk', () => {
  expect(clip('aaa\nbbb\nccc\n', 9)).toEqual({ text: 'aaa\nbbb\n', isCut: true })
  expect(clip('short', 9)).toEqual({ text: 'short', isCut: false })
  const diffText = '@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9,1 +9,1 @@\n-c\n+d\n'
  expect(clip(diffText, 30, '\n@@')).toEqual({ text: '@@ -1,1 +1,1 @@\n-a\n+b\n', isCut: true })
})

test('links inside code, images and other targets stay as written', () => {
  const source = '```\n[a](a.md)\n```\n`[b](b.md)` ![c](c.md) [d](#d) [e](/e.md) [f](f.txt) [g](g.md)'
  const { text, links } = linkify(source, '/r')
  expect(text).toBe('```\n[a](a.md)\n```\n`[b](b.md)` ![c](c.md) [d](#d) [e](/e.md) [f](f.txt) [g](file:///r/g.md)')
  expect([...links.keys()]).toEqual(['file:///r/g.md'])
})

test('a /peek argument is a command, git, or a path with an optional line or range', () => {
  expect(parseTarget('')).toEqual({ kind: 'empty' })
  expect(parseTarget('  !ls -la ')).toEqual({ kind: 'command', command: 'ls -la' })
  expect(parseTarget('!')).toEqual({ kind: 'empty' })
  expect(parseTarget('git')).toEqual({ kind: 'git' })
  expect(parseTarget('gitignore')).toEqual({ kind: 'path', path: 'gitignore' })
  expect(parseTarget('src/a.ts')).toEqual({ kind: 'path', path: 'src/a.ts' })
  expect(parseTarget('src/a.ts:12')).toEqual({ kind: 'path', path: 'src/a.ts', lines: [12, 12] })
  expect(parseTarget('src/a.ts:14-12')).toEqual({ kind: 'path', path: 'src/a.ts', lines: [12, 14] })
  expect(parseTarget('src/a.ts:0')).toEqual({ kind: 'path', path: 'src/a.ts:0' })
})

test('terminal output loses escape sequences and control characters, and keeps what \r left last', () => {
  expect(clean('\u001b[1;31mred\u001b[0m bold\u001b[K')).toBe('red bold')
  expect(clean('\u001b]0;title\u0007after')).toBe('after')
  expect(clean('a\r\nb\r\n')).toBe('a\nb\n')
  expect(clean('1/3\r2/3\r3/3 done')).toBe('3/3 done')
  expect(clean('tab\there\u0008\u0000')).toBe('tab\there')
  expect(clean('next\u0085line')).toBe('nextline')
  expect(dropShellNoise("(eval):1: can't change option: zle\nreal error")).toBe('real error')
})

test('a control character shows as its picture, so a drawing takes any text', () => {
  expect(visible('build \u001b[32mok\u001b[0m')).toBe('build ␛[32mok␛[0m')
  expect(visible('a\r\nb\r\n')).toBe('a\nb\n')
  expect(visible('Icon\r')).toBe('Icon␍')
  expect(visible('page\fbreak\u0007\u0000\u007f')).toBe('page␌break␇␀␡')
  expect(visible('next\u0085line')).toBe('next\ufffdline')
  expect(visible('tab\there\nline sep')).toBe('tab\there\nline sep')
})

test('a fence is longer than any run of backticks inside it', () => {
  expect(fenced('plain\n')).toBe('```\nplain\n```')
  expect(fenced('has ```` four')).toBe('`````\nhas ```` four\n`````')
})

test('git status marks files and the folders above them, within the folder shown', () => {
  const output = [
    '# branch.oid 1111',
    '# branch.head main',
    '1 .M N... 100644 100644 100644 a a src/a.ts',
    '1 A. N... 000000 100644 100644 0 b src/new.ts',
    '1 .D N... 100644 100644 000000 a a gone.md',
    '2 R. N... 100644 100644 100644 a a R100 src/b.ts',
    'src/old.ts',
    'u UU N... 100644 100644 100644 100644 a b c both.ts',
    'u AA N... 000000 100644 100644 100644 0 b c added.ts',
    '? scratch/',
    '? docs/x.md',
    '',
  ].join('\0')
  expect(statusBadges(output, '')).toEqual({
    'src/a.ts': 'M',
    src: '•',
    'src/new.ts': 'A',
    'gone.md': 'D',
    'src/b.ts': 'R',
    'both.ts': 'M',
    'added.ts': 'A',
    scratch: '?',
    'docs/x.md': '?',
    docs: '•',
  })
  expect(statusBadges(output, 'src')).toEqual({ 'a.ts': 'M', 'new.ts': 'A', 'b.ts': 'R' })
})

test('a tree lists folders first, dims what git ignores below an ignored folder, and holds back a long folder', () => {
  const entries = sortEntries([
    { name: 'b.md', kind: 'file' },
    { name: '.git', kind: 'dir' },
    { name: 'Zeta', kind: 'dir' },
    { name: 'a.md', kind: 'file' },
    { name: 'node_modules', kind: 'dir' },
  ])
  expect(entries.map(entry => entry.name)).toEqual(['node_modules', 'Zeta', 'a.md', 'b.md'])
  const many = Array.from({ length: 102 }, (_, i) => ({ name: `f${i}`, kind: 'file' as const }))
  const input = {
    listings: { '': entries, node_modules: [{ name: 'x', kind: 'dir' as const }], Zeta: many },
    expanded: ['node_modules', 'Zeta'],
    full: [],
    badges: {},
    ignored: ['node_modules/'],
  }
  const { rows } = treeRows(input)
  expect(rows.slice(0, 3).map(row => [row.prefix + row.name, row.isIgnored])).toEqual([
    ['├── node_modules', true],
    ['│   └── x', true],
    ['├── Zeta', false],
  ])
  expect(rows.filter(row => row.kind === 'more')).toEqual([{ path: 'Zeta', name: '', kind: 'more', prefix: '│   └── ', isIgnored: false, hidden: 2 }])
  expect(treeText('r/', rows, n => `+${n}`).split('\n').slice(-3)).toEqual(['│   └── +2', '├── a.md', '└── b.md'])
  // git names a folder it ignores whole, asked from inside, as ./
  const inside = treeRows({ ...input, ignored: ['./'] }).rows
  expect(inside.every(row => row.kind === 'more' || row.isIgnored)).toBe(true)
  // A name's control characters show as their pictures, as the pane draws them.
  const named = treeRows({ listings: { '': [{ name: 'Icon\r', kind: 'file' }] }, expanded: [], full: [], badges: {}, ignored: [] }).rows
  expect(treeText('r/', named, n => `+${n}`)).toBe('r/\n└── Icon␍')
})

test('porcelain v2 status reads the branch, upstream, stash and files of each kind, renames and conflicts too', () => {
  const output = [
    '# branch.oid abc',
    '# branch.head feature',
    '# branch.upstream origin/feature',
    '# branch.ab +0 -3',
    '# stash 2',
    '1 MM N... 100644 100644 100644 a b src/with space.ts',
    '2 R. N... 100644 100644 100644 a b R100 new.ts',
    'old.ts',
    'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
    '? new dir/',
    '',
  ].join('\0')
  expect(parseStatus(output)).toEqual({
    branch: 'feature',
    oid: 'abc',
    upstream: 'origin/feature',
    ahead: 0,
    behind: 3,
    stash: 2,
    staged: [{ path: 'src/with space.ts', mark: 'M' }, { path: 'new.ts', mark: 'R' }],
    unstaged: [{ path: 'src/with space.ts', mark: 'M' }, { path: 'conflict.ts', mark: 'U' }],
    untracked: ['new dir/'],
  })
})

test('a graph log keeps the lines without a commit, and a commit line reads as drawn', () => {
  const lines = parseLog('*\u001fa1\u001fHEAD -> main\u001fOne\u001f1 day ago\n|\\\n| *\u001fb2\u001f\u001fTwo\u001f2 days ago\n')
  expect(lines.map(logLineText)).toEqual(['* a1 (HEAD -> main) One 1 day ago', '|\\', '| * b2 Two 2 days ago'])
})

test('a patch splits by file, a binary or mode change keeping what git says', () => {
  const patch = [
    'diff --git a/a.ts b/a.ts',
    'index 1..2 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1 +1 @@',
    '-x',
    '+y',
    'diff --git a/img.png b/img.png',
    'index 3..4 100644',
    'Binary files a/img.png and b/img.png differ',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-z',
    '',
  ].join('\n')
  expect(splitPatch(patch)).toEqual([
    { path: 'a.ts', hunks: '@@ -1 +1 @@\n-x\n+y\n', note: '' },
    { path: 'img.png', hunks: '', note: 'Binary files a/img.png and b/img.png differ' },
    { path: 'gone.ts', hunks: '@@ -1 +0,0 @@\n-z\n', note: '' },
  ])
})

test('a path git quotes (a quote, a backslash or a control character in it) reads as it is', () => {
  const patch = [
    'diff --git "a/say \\"hi\\".md" "b/say \\"hi\\".md"',
    'new file mode 100644',
    '--- /dev/null',
    '+++ "b/say \\"hi\\".md"',
    '@@ -0,0 +1 @@',
    '+hi',
    'diff --git "a/back\\\\slash\\ttab.md" "b/back\\\\slash\\ttab.md"',
    'deleted file mode 100644',
    '--- "a/back\\\\slash\\ttab.md"',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-x',
    'diff --git "a/bell\\007.bin" "b/bell\\007.bin"',
    'index 3..4 100644',
    'Binary files "a/bell\\007.bin" and "b/bell\\007.bin" differ',
    'diff --git a/my img.png b/my img.png',
    'index 3..4 100644',
    'Binary files a/my img.png and b/my img.png differ',
    '',
  ].join('\n')
  expect(splitPatch(patch).map(file => file.path)).toEqual(['say "hi".md', 'back\\slash\ttab.md', 'bell\u0007.bin', 'my img.png'])
})

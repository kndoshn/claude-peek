import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PANE, autocomplete, button, engine, pane, peek, press, pressPane, start, turnEnds } from './support'
import type { Files } from './support'

// The rows of the tree the pane draws, as their text.
async function rows($: Engine): Promise<string[]> {
  const ui = await $.ui.mount(PANE)
  const buttons = await ui.findAll({ type: 'Button' })
  await ui.unmount()
  return buttons.map(found => found.text)
}

const DOCS: Files = {
  '/proj/docs/a.md': 'a',
  '/proj/docs/guide/b.md': 'b',
  '/proj/docs/guide/c.md': 'c',
  '/proj/docs/.hidden': 'h',
  '/proj/docs/.git/HEAD': 'ref',
}

test('/peek <folder> shows its tree, small folders open, .git left out', async ($, on) => {
  const r = engine(on, DOCS)

  expect((await peek($, 'docs')).text).toBe('Opened docs/')
  expect(r.opened).toEqual(['docs/'])
  expect((await pane($)).header).toBe('/proj/docs')
  expect(await rows($)).toEqual(['├── guide/', '│   ├── b.md', '│   └── c.md', '├── .hidden', '└── a.md'])
  // A long path keeps its end, the folder and the branch, on one row.
  expect((await pane($)).headingWrap).toBe('truncate-start')
})

test('a folder opens and closes when clicked; a file opens in the file view, and Back returns', async ($, on) => {
  const r = engine(on, DOCS)
  await peek($, 'docs')

  await pressPane($, 'tree:guide')
  expect(await rows($)).toEqual(['├── guide/', '├── .hidden', '└── a.md'])
  await pressPane($, 'tree:guide')
  expect((await rows($)).length).toBe(5)

  await pressPane($, 'tree:guide/b.md')
  expect(r.opened).toEqual(['docs/', 'b.md'])
  await press($, 'back')
  expect(r.opened).toEqual(['docs/', 'b.md', 'docs/'])
  expect((await rows($)).length).toBe(5)
})

test('a large folder stays closed, and opened it shows 100 entries until asked for the rest', async ($, on) => {
  const files: Files = {}
  for (let i = 0; i < 250; i += 1) files[`/proj/big/f${String(i).padStart(3, '0')}.txt`] = 'x'
  engine(on, files)
  await peek($, '.')

  expect(await rows($)).toEqual(['└── big/'])
  await pressPane($, 'tree:big')
  const opened = await rows($)
  expect(opened.length).toBe(102)
  expect(opened.at(-1)).toBe('    └── … 150 more')
  await pressPane($, 'more:big')
  expect((await rows($)).length).toBe(251)
})

test('in a repository the tree marks changed files and their folders, and dims what git ignores', async ($, on) => {
  const r = engine(on, {
    '/proj/docs/a.md': 'a',
    '/proj/docs/new.md': 'n',
    '/proj/docs/c.md': 'c',
    '/proj/build/out.js': 'o',
    '/proj/README.md': 'r',
  })
  r.commands['git rev-parse --show-prefix'] = { exitCode: 0, stdout: '\n' }
  r.commands['git branch --show-current'] = { exitCode: 0, stdout: 'main\n' }
  r.commands['git status --porcelain=v1 -z --untracked-files=normal'] = {
    exitCode: 0,
    stdout: ' M docs/a.md\0?? docs/new.md\0R  docs/c.md\0docs/b.md\0',
  }
  r.commands['git ls-files -z --others --ignored --exclude-standard --directory'] = { exitCode: 0, stdout: 'build/\0' }

  await peek($)
  expect((await pane($)).header).toBe('/proj · main')
  expect(await rows($)).toEqual([
    '├── build/',
    '├── docs/ •',
    '│   ├── a.md M',
    '│   ├── c.md R',
    '│   └── new.md ?',
    '└── README.md',
  ])
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ key: 'tree:build' }))?.props.dimColor).toBe(true)
  await ui.unmount()
  const status = r.ran.find(run => run.argv[1] === 'status')
  expect(status).toMatchObject({ cwd: '/proj', env: { GIT_OPTIONAL_LOCKS: '0' } })
})

test('a folder below the top of a repository is marked by its place there, whatever path led to it, and a detached head names no branch', async ($, on) => {
  const r = engine(on, { '/proj/docs/a.md': 'a', '/proj/docs/b.md': 'b' })
  // git answers these in a repository without commits too, and from the folder's real path.
  r.commands['git rev-parse --show-prefix'] = { exitCode: 0, stdout: 'docs/\n' }
  r.commands['git branch --show-current'] = { exitCode: 0, stdout: '\n' }
  r.commands['git status --porcelain=v1 -z --untracked-files=normal'] = { exitCode: 0, stdout: '?? docs/a.md\0 M README.md\0' }

  await peek($, 'docs')
  expect((await pane($)).header).toBe('/proj/docs')
  expect(await rows($)).toEqual(['├── a.md ?', '└── b.md'])
})

test('a link to a folder opens as a folder when clicked, and a link to a file as the file', async ($, on) => {
  const r = engine(on, { '/proj/docs/a.md': 'a', '/shared/notes/n.md': 'n', '/shared/x.md': 'x' })
  r.links['/proj/notes'] = '/shared/notes'
  r.links['/proj/x.md'] = '/shared/x.md'

  await peek($, '.')
  // A link is not opened at first: it may lead anywhere, up to a folder above.
  expect(await rows($)).toEqual(['├── docs/', '│   └── a.md', '├── notes/', '└── x.md'])
  await pressPane($, 'tree:notes')
  expect(await rows($)).toEqual(['├── docs/', '│   └── a.md', '├── notes/', '│   └── n.md', '└── x.md'])
  await pressPane($, 'tree:x.md')
  expect(r.opened.at(-1)).toBe('x.md')
  expect(r.toasts).toEqual([])
})

test('~ alone is the home folder', async ($, on) => {
  const r = engine(on, { '/home/me/notes/a.md': 'a', '/home/me/repos/github.com/me/x/README.md': 'r' })
  r.commands.ghq = { exitCode: 0, stdout: '/home/me/repos/github.com/me/x\n' }

  await peek($, '~')
  expect((await pane($)).header).toBe('~')
})

test('the band quotes the tree, mentions the chosen folder and copies the tree', async ($, on) => {
  const r = engine(on, DOCS)
  await peek($, 'docs')
  const tree = 'docs/\n├── guide/\n│   ├── b.md\n│   └── c.md\n├── .hidden\n└── a.md'

  expect(await button($, 'quote-tree')).toBe('Quote tree')
  await press($, 'quote-tree')
  expect(r.filled[0]?.text).toBe(`tree docs/\n\`\`\`\n${tree}\n\`\`\`\n\n`)

  await press($, 'mention')
  expect(r.filled[1]?.text).toBe('@docs/ ')
  await pressPane($, 'tree:guide')
  await press($, 'mention')
  expect(r.filled[2]?.text).toBe('@docs/guide/ ')

  await pressPane($, 'tree:guide')
  await press($, 'copy')
  expect(r.copied).toEqual([tree])
})

test('a selection in the tree is quoted under the folder', async ($, on) => {
  const r = engine(on, DOCS)
  await peek($, 'docs')
  r.selection = { text: '│   ├── b.md\n│   └── c.md' }

  await press($, 'quote')
  expect(r.filled[0]?.text).toBe('tree docs/\n> │   ├── b.md\n> │   └── c.md\n\n')
})

test('part of a name finds a folder or a repository of ghq', async ($, on) => {
  const r = engine(on, { '/home/me/repos/github.com/pentim/shok/README.md': 'r', '/proj/docs/guide/x.md': 'x' })
  r.commands.ghq = { exitCode: 0, stdout: '/home/me/repos/github.com/pentim/shok\n' }
  r.git = { exitCode: 0, stdout: 'docs/guide/x.md\0' }

  await peek($, 'shok')
  expect(r.opened).toEqual(['shok/'])
  expect((await pane($)).header).toBe('~/repos/github.com/pentim/shok')
  await peek($, 'guid')
  expect(r.opened).toEqual(['shok/', 'guide/'])
})

test('letters that only appear in order in a name open nothing, and completion still offers it', async ($, on) => {
  const r = engine(on, { '/home/me/repos/github.com/me/kabutan-chart-extension/README.md': 'r' })
  r.commands.ghq = { exitCode: 0, stdout: '/home/me/repos/github.com/me/kabutan-chart-extension\n' }

  expect((await peek($, 'tree')).text).toContain('Nothing matches "tree"')
  expect(r.opened).toEqual([])
  const offered = (await autocomplete($, '/peek tree')).suggestions.map(s => s.label)
  expect(offered).toContain('kabutan-chart-extension/')
})

test('the tree is not read while another tab stands in front of the pane', async ($, on) => {
  const files: Files = { '/proj/docs/a.md': 'a' }
  const r = engine(on, files)
  await start($)
  await peek($, 'docs')
  r.isShown = false
  files['/proj/docs/b.md'] = 'b'
  await r.clock.advance(10000)
  expect(r.ran.filter(run => run.argv[1] === 'rev-parse').length).toBe(1)

  r.isShown = true
  await r.clock.advance(1000)
  expect(await rows($)).toEqual(['├── a.md', '└── b.md'])
})

test('the tree is read again every 5 seconds while shown, and when a turn ends', async ($, on) => {
  const files: Files = { '/proj/docs/a.md': 'a' }
  const r = engine(on, files)
  await start($)
  await peek($, 'docs')

  files['/proj/docs/b.md'] = 'b'
  await r.clock.advance(1000)
  expect(await rows($)).toEqual(['└── a.md'])
  await r.clock.advance(4000)
  expect(await rows($)).toEqual(['├── a.md', '└── b.md'])

  files['/proj/docs/c.md'] = 'c'
  await turnEnds($)
  await r.clock.advance(1000)
  expect(await rows($)).toEqual(['├── a.md', '├── b.md', '└── c.md'])
})

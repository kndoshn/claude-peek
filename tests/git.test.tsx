import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PANE, autocomplete, button, command, engine, pane, peek, press, pressPane, start, turnEnds } from './support'
import type { Recorded } from './support'

const STATUS = [
  '# branch.oid 1111111111111111111111111111111111111111',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +1 -2',
  '# stash 1',
  '1 M. N... 100644 100644 100644 aaa bbb src/a.ts',
  '1 .M N... 100644 100644 100644 aaa bbb docs/b.md',
  '? notes.txt',
  '',
].join('\0')

const LOG = [
  '*\u001fabc1234\u001fHEAD -> main, origin/main\u001fFix the parser\u001f2 hours ago',
  '|\\',
  '| *\u001fdef5678\u001f\u001fAdd a test\u001f3 days ago',
  '',
].join('\n')

const SHOW_HEAD = 'abc1234\u001fKen\u001f2026-11-01 10:00\u001fFix the parser\u001fIt dropped the last line.\n'
const SHOW_STAT = ' src/a.ts | 3 ++-\n 1 file changed, 2 insertions(+), 1 deletion(-)\n'
const SHOW_PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' one',
  '-two',
  '+2',
  '+three',
  '',
].join('\n')

// A repository at /proj with the status, log and commit above.
function repository(r: Recorded, status = STATUS) {
  r.commands['git rev-parse --show-toplevel'] = { exitCode: 0, stdout: '/proj\n' }
  r.commands['git status --porcelain=v2 --branch --show-stash -z --untracked-files=normal'] = { exitCode: 0, stdout: status }
  r.commands['git log --graph --format=%x1f%h%x1f%D%x1f%s%x1f%ar -n 40 --color=never'] = { exitCode: 0, stdout: LOG }
  r.commands['git show -s --format=%h%x1f%an%x1f%ad%x1f%s%x1f%b --date=format:%Y-%m-%d %H:%M abc1234'] = { exitCode: 0, stdout: SHOW_HEAD }
  r.commands['git show --format= --stat=120 --no-color --diff-merges=first-parent abc1234'] = { exitCode: 0, stdout: SHOW_STAT }
  r.commands['git show --format= --patch --no-color --no-ext-diff --diff-merges=first-parent abc1234'] = { exitCode: 0, stdout: SHOW_PATCH }
}

async function texts($: Engine, type: 'Button' | 'Text'): Promise<string[]> {
  const ui = await $.ui.mount(PANE)
  const found = await ui.findAll({ type })
  await ui.unmount()
  return found.map(element => element.text)
}

test('/peek git shows the branch, the changes by kind and the history', async ($, on) => {
  const r = engine(on, { '/proj/src/a.ts': 'a' })
  repository(r)

  expect((await peek($, 'git')).text).toBe('Opened Git')
  expect((await pane($)).header).toBe('/proj · main ↑1 ↓2 · stash 1')
  expect((await pane($)).headingWrap).toBe('truncate-start')
  expect(await texts($, 'Button')).toEqual([
    'M src/a.ts',
    'M docs/b.md',
    '? notes.txt',
    '* abc1234 (HEAD -> main, origin/main) Fix the parser 2 hours ago',
    '| * def5678 Add a test 3 days ago',
  ])
  const headings = await texts($, 'Text')
  for (const heading of ['Staged (1)', 'Not staged (1)', 'Untracked (1)', 'History', 'Diffs of the work in progress: /diff']) {
    expect(headings).toContain(heading)
  }
  const status = r.ran.find(run => run.argv[1] === 'status')
  expect(status).toMatchObject({ cwd: '/proj', env: { GIT_OPTIONAL_LOCKS: '0' } })
})

test('git writes paths as they are, not quoted with their bytes in octal', async ($, on) => {
  const r = engine(on, {})
  repository(r)
  await peek($, 'git')
  await pressPane($, 'commit:abc1234')

  const shows = r.ran.filter(run => run.argv[1] === 'show')
  expect(shows.length).toBe(3)
  for (const show of shows) {
    expect(show.env).toMatchObject({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.quotePath', GIT_CONFIG_VALUE_0: 'false' })
  }
})

test('a folder in the status (untracked, a link to one, a submodule) opens in the tree', async ($, on) => {
  const r = engine(on, { '/proj/new/a.md': 'a', '/shared/b.md': 'b' })
  r.links['/proj/linked'] = '/shared'
  repository(r, ['# branch.oid 1', '# branch.head main', '? linked', '? new/', ''].join('\0'))
  await peek($, 'git')

  await pressPane($, 'git-file:untracked:new/')
  await press($, 'back')
  await pressPane($, 'git-file:untracked:linked')
  expect(r.toasts).toEqual([])
  expect(r.opened).toEqual(['git', 'new/', 'git', 'linked/'])
})

test('a changed file opens in the file view, and Back returns to Git', async ($, on) => {
  const r = engine(on, { '/proj/src/a.ts': 'a' })
  repository(r)
  await peek($, 'git')

  await pressPane($, 'git-file:staged:src/a.ts')
  expect(r.opened).toEqual(['git', 'a.ts'])
  await press($, 'back')
  expect(r.opened).toEqual(['git', 'a.ts', 'git'])
})

test('a commit opens its details and diff, the band puts it in the prompt, and Back returns to the history', async ($, on) => {
  const r = engine(on, {})
  repository(r)
  await peek($, 'git')

  await pressPane($, 'commit:abc1234')
  const { header, headingWrap, codes } = await pane($)
  expect(header).toBe('abc1234 Fix the parser')
  expect(headingWrap).toBe('truncate-end')
  expect(codes.map(code => [code.format ?? 'source', code.source])).toEqual([
    ['source', SHOW_STAT],
    ['diff', '@@ -1,2 +1,3 @@\n one\n-two\n+2\n+three\n'],
  ])
  expect(await texts($, 'Text')).toContain('Ken · 2026-11-01 10:00')

  expect(await button($, 'mention')).toBe('Commit to prompt')
  await press($, 'mention')
  expect(r.filled[0]?.text).toBe('abc1234 (Fix the parser) ')

  await press($, 'back')
  expect((await pane($)).header).toBe('/proj · main ↑1 ↓2 · stash 1')
  expect(await button($, 'mention')).toBeUndefined()
})

test('control characters in what git prints show as their pictures, and a path holding one still opens', async ($, on) => {
  const r = engine(on, { '/proj/Icon\r': '' })
  repository(r, ['# branch.oid 1', '# branch.head main', '? Icon\r', ''].join('\0'))
  r.commands['git log --graph --format=%x1f%h%x1f%D%x1f%s%x1f%ar -n 40 --color=never'] = {
    exitCode: 0,
    stdout: '*\u001fabc1234\u001f\u001fColour \u001b[1mbold\u001f1 hour ago\n',
  }
  r.commands['git show -s --format=%h%x1f%an%x1f%ad%x1f%s%x1f%b --date=format:%Y-%m-%d %H:%M abc1234'] = {
    exitCode: 0,
    stdout: 'abc1234\u001fKen\u001f2026-11-01 10:00\u001fColour \u001b[1mbold\u001fA bell\u0007 rang.\n',
  }
  r.commands['git show --format= --patch --no-color --no-ext-diff --diff-merges=first-parent abc1234'] = {
    exitCode: 0,
    stdout: ['diff --git a/log.txt b/log.txt', '--- a/log.txt', '+++ b/log.txt', '@@ -1 +1 @@', '-\u001b[32mok', '+\u001b[31mfail', ''].join('\n'),
  }
  await peek($, 'git')

  expect(await texts($, 'Button')).toEqual(['? Icon␍', '* abc1234 Colour ␛[1mbold 1 hour ago'])
  await pressPane($, 'git-file:untracked:Icon\r')
  expect(r.toasts).toEqual([])
  expect(r.opened.at(-1)).toBe('Icon␍')

  await press($, 'back')
  await pressPane($, 'commit:abc1234')
  expect((await pane($)).header).toBe('abc1234 Colour ␛[1mbold')
  expect(await texts($, 'Text')).toContain('A bell␇ rang.')
  expect((await pane($)).codes.map(code => code.source)).toContain('@@ -1 +1 @@\n-␛[32mok\n+␛[31mfail\n')
})

test('a selection is quoted under what it came from: the status, the history or a commit', async ($, on) => {
  const r = engine(on, {})
  repository(r)
  await peek($, 'git')

  r.selection = { text: 'M src/a.ts' }
  await press($, 'quote')
  r.selection = { text: '* abc1234 (HEAD -> main, origin/main) Fix the parser' }
  await press($, 'quote')
  await pressPane($, 'commit:abc1234')
  r.selection = { text: '+three' }
  await press($, 'quote')
  expect(r.filled.map(fill => fill.text.split('\n')[0])).toEqual(['git status', 'git log', 'git show abc1234'])
})

test('outside a repository /peek git says so', async ($, on) => {
  const r = engine(on, {})
  expect((await peek($, 'git')).text).toBe('Not in a git repository')
  expect(r.opened).toEqual([])
})

test('a detached head and a repository without commits read as such', async ($, on) => {
  const r = engine(on, {})
  repository(r, ['# branch.oid (initial)', '# branch.head (detached)', ''].join('\0'))
  r.commands['git log --graph --format=%x1f%h%x1f%D%x1f%s%x1f%ar -n 40 --color=never'] = { exitCode: 128, stdout: '' }

  await peek($, 'git')
  expect((await pane($)).header).toBe('/proj · detached')
  const headings = await texts($, 'Text')
  expect(headings).toContain('Nothing to commit')
  expect(headings).toContain('No commits yet')
})

test('Git is read again every 5 seconds while shown, and Refresh reads it at once', async ($, on) => {
  const r = engine(on, {})
  repository(r)
  await start($)
  await peek($, 'git')

  repository(r, ['# branch.oid 1', '# branch.head main', ''].join('\0'))
  await r.clock.advance(1000)
  expect((await texts($, 'Button')).length).toBe(5)
  await r.clock.advance(4000)
  expect((await texts($, 'Button')).length).toBe(2)

  repository(r)
  await press($, 'refresh')
  expect((await texts($, 'Button')).length).toBe(5)
})

test('an open commit is read once, and the history again only when the status moved or something may have changed it', async ($, on) => {
  const r = engine(on, {})
  repository(r)
  await start($)
  await peek($, 'git')
  await pressPane($, 'commit:abc1234')
  const runs = (sub: string) => r.ran.filter(run => run.argv[1] === sub).length
  expect([runs('status'), runs('log'), runs('show')]).toEqual([2, 2, 3])

  // Nothing moved: the status alone is read.
  await r.clock.advance(5000)
  expect([runs('status'), runs('log'), runs('show')]).toEqual([3, 2, 3])

  // A turn ended: all is read again but the commit, which never changes.
  await turnEnds($)
  await r.clock.advance(1000)
  expect([runs('status'), runs('log'), runs('show')]).toEqual([4, 3, 3])

  // The status moved: the history is read again.
  r.commands['git status --porcelain=v2 --branch --show-stash -z --untracked-files=normal'] = { exitCode: 0, stdout: STATUS.replace('+1 -2', '+2 -2') }
  await r.clock.advance(5000)
  expect(runs('log')).toBe(4)
  expect((await pane($)).header).toBe('abc1234 Fix the parser')
  await press($, 'back')
  expect((await pane($)).header).toBe('/proj · main ↑2 ↓2 · stash 1')
})

test('Git is not read while another tab stands in front of the pane', async ($, on) => {
  const r = engine(on, {})
  repository(r)
  await start($)
  await peek($, 'git')
  r.isShown = false
  await turnEnds($)
  await r.clock.advance(10000)
  expect(r.ran.filter(run => run.argv[1] === 'status').length).toBe(1)

  r.isShown = true
  await r.clock.advance(1000)
  expect(r.ran.filter(run => run.argv[1] === 'status').length).toBe(2)
})

test('completion offers git for /peek', async ($, on) => {
  engine(on, {})
  expect((await autocomplete($, '/peek gi')).suggestions[0]).toEqual({ text: 'git', label: 'git', description: 'Git' })
})

test('/tree and /git are there only when the setting asks for them, and left to others otherwise', async ($, on) => {
  const r = engine(on, {})
  repository(r)
  // Another plugin's /git, beneath peek.
  on('command.run', { command: 'git' }, () => ({ text: 'theirs' }))
  await start($)
  expect(r.registered).toEqual(['peek', 'md'])

  expect((await command($, 'git', '')).text).toBe('theirs')
  expect(r.opened).toEqual([])
})

test('with the setting on, /tree and /git open their views', { options: { shortCommands: true } }, async ($, on) => {
  const r = engine(on, { '/proj/docs/a.md': 'a' })
  repository(r)
  await start($)
  expect(r.registered).toEqual(['peek', 'md', 'tree', 'git'])

  expect((await command($, 'tree', 'docs')).text).toBe('Opened docs/')
  expect((await command($, 'tree', '')).text).toBe('Opened ./')
  expect((await command($, 'git', '')).text).toBe('Opened Git')
})

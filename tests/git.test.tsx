import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PANE, autocomplete, button, command, engine, pane, peek, press, pressPane, start } from './support'
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
  const { header, codes } = await pane($)
  expect(header).toBe('abc1234 Fix the parser')
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

test('completion offers git for /peek', async ($, on) => {
  engine(on, {})
  expect((await autocomplete($, '/peek gi')).suggestions[0]).toEqual({ text: 'git', label: 'git', description: 'Git' })
})

test('/tree and /git are there only when the setting asks for them', async ($, on) => {
  const r = engine(on, {})
  await start($)
  expect(r.registered).toEqual(['peek', 'md'])
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

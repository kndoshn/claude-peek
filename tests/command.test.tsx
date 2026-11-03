import { expect, test } from 'claude-code/testing'

import { autocomplete, button, CWD, engine, pane, peek, press } from './support'
import type { Run } from './support'

test('/peek !command runs it in the person\'s interactive shell and shows its output', async ($, on) => {
  const r = engine(on, {})
  r.env = { SHELL: '/bin/zsh' }
  r.commands['/bin/zsh'] = { exitCode: 0, stdout: 'a.md\nb.md\n' }

  expect((await peek($, '!ls -la')).text).toBe('Opened $ ls -la')
  // Its stdin is /dev/null, as with no input in a terminal: rg searches the folder, not stdin.
  expect(r.ran).toEqual([
    { argv: ['/bin/sh', '-c', 'exec "$0" -ic "$1" </dev/null', '/bin/zsh', 'ls -la'], cwd: CWD, env: { PEEK: '1' }, stdin: '', timeoutMs: 30000 },
  ])
  // Opened while it ran, then fitted to its output.
  expect(r.opened).toEqual(['$ ls -la', '$ ls -la'])
  const { header, headingWrap, codes } = await pane($)
  expect(header).toBe('$ ls -la · exit 0')
  // A long command keeps its start and how it ended.
  expect(headingWrap).toBe('truncate-middle')
  expect(codes.map(code => code.source)).toEqual(['a.md\nb.md\n'])
})

test('without a SHELL the command runs in /bin/sh', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = { exitCode: 0, stdout: 'ok' }

  await peek($, '!echo ok')
  expect(r.ran[0]?.argv).toEqual(['/bin/sh', '-c', 'exec "$0" -ic "$1" </dev/null', '/bin/sh', 'echo ok'])
})

test('the output loses its colours, carriage returns and the shell\'s warnings; errors show apart', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = {
    exitCode: 2,
    stdout: '\u001b[32mgreen\u001b[0m\r\n10%\r50%\r100%\n\u001b]8;;https://x\u0007link\u001b]8;;\u0007\n',
    stderr: "(eval):1: can't change option: zle\nboom\n",
  }

  await peek($, '!make')
  const { header, codes } = await pane($)
  expect(header).toBe('$ make · exit 2')
  expect(codes.map(code => code.source)).toEqual(['green\n100%\nlink\n', 'boom\n'])
})

test('a command that runs past the limit is stopped and the header says so', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = async () => {
    await r.clock.advance(30_000)
    throw new Error('the process ran past its time')
  }

  await peek($, '!sleep 99')
  expect((await pane($)).header).toBe('$ sleep 99 · stopped after 30 s')
})

test('a command that cannot run says so, with why', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = () => {
    throw new Error('spawn failed')
  }

  await peek($, '!nope')
  const { header, codes } = await pane($)
  expect(header).toBe('$ nope · could not run')
  expect(codes).toHaveLength(1)
})

test('the time limit comes from the settings', { options: { commandTimeoutSeconds: 5 } }, async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = { exitCode: 0, stdout: '' }

  await peek($, '!true')
  expect(r.ran[0]?.timeoutMs).toBe(5000)
})

test('Run again runs the command anew, where it ran before', async ($, on) => {
  const r = engine(on, {})
  let n = 0
  r.commands['/bin/sh'] = () => ({ exitCode: 0, stdout: `run ${(n += 1)}\n` })

  await peek($, '!date')
  r.cwd = '/proj/.worktrees/x'
  await press($, 'rerun')
  expect((await pane($)).code?.source).toBe('run 2\n')
  expect(r.ran.map(run => run.cwd)).toEqual([CWD, CWD])
})

test('a selection of the output is quoted under the command; the whole output too', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = { exitCode: 0, stdout: 'one\ntwo ```\nthree\n' }
  await peek($, '!cat x')

  r.selection = { text: 'two ```' }
  await press($, 'quote')
  expect(r.filled[0]?.text).toBe('$ cat x\n> two ```\n\n')

  r.selection = { text: 'elsewhere' }
  await press($, 'quote')
  expect(r.filled[1]?.text).toBe('> elsewhere\n\n')

  await press($, 'quote-all')
  expect(r.filled[2]?.text).toBe('$ cat x\n````\none\ntwo ```\nthree\n````\n\n')
})

test('Copy puts the output on the clipboard', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = { exitCode: 0, stdout: 'out\n' }
  await peek($, '!echo out')

  await press($, 'copy')
  expect(r.copied).toEqual(['out\n'])
})

test('completion offers the commands run before, the newest first', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = { exitCode: 0, stdout: '' }
  await peek($, '!ls -la')
  await peek($, '!git lg')
  await peek($, '!ls -la')

  const texts = async (text: string) => (await autocomplete($, text)).suggestions.map(s => s.text)
  expect(await texts('/peek !')).toEqual(['!ls -la', '!git lg'])
  expect(await texts('/peek !g')).toEqual(['!git lg'])
})

test('the band switches between the views opened, and /peek alone reopens the last without running', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.commands['/bin/sh'] = { exitCode: 0, stdout: 'out\n' }
  await peek($, 'a.md')
  await peek($, '!echo out')
  expect(await button($, 'view:file')).toBe('File')
  expect(await button($, 'view:command')).toBe('Command')

  await press($, 'view:file')
  expect((await pane($)).markdown?.text).toBe('a')
  await press($, 'view:command')
  expect((await pane($)).code?.source).toBe('out\n')

  await press($, 'close')
  await peek($)
  expect((await pane($)).code?.source).toBe('out\n')
  expect(r.ran.filter(run => run.argv[0] === '/bin/sh')).toHaveLength(1)
})

test('a view not yet opened opens at its default: the tree and Git at the working directory, the file view with how to open a file', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.commands['/bin/sh'] = { exitCode: 0, stdout: 'out\n' }
  r.commands['git rev-parse --show-toplevel'] = { exitCode: 0, stdout: '/proj\n' }
  r.commands['git status --porcelain=v2 --branch --show-stash -z --untracked-files=normal'] = {
    exitCode: 0,
    stdout: ['# branch.oid 1', '# branch.head main', ''].join('\0'),
  }
  await peek($, '!echo out')

  await press($, 'view:file')
  expect((await pane($, 'hint')).keyed?.text).toBe('/peek [path] shows a file here')
  await press($, 'view:tree')
  expect((await pane($)).header).toBe('/proj')
  await press($, 'view:git')
  expect((await pane($)).header).toBe('/proj · main')
  expect(r.toasts).toEqual([])
})

test('Git not yet opened outside a repository says so and leaves the pane as it was', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = { exitCode: 0, stdout: 'out\n' }
  await peek($, '!echo out')

  await press($, 'view:git')
  expect(r.toasts).toEqual(['Not in a git repository'])
  expect((await pane($)).code?.source).toBe('out\n')
})

test('inline, the pane is as tall as the output, and the errors with their heading', async ($, on) => {
  const r = engine(on, {})
  const rows = async (command: string, run: Run) => {
    r.commands['/bin/sh'] = run
    await peek($, command)
    return r.opens.at(-1)?.rows
  }

  // The header and its gap, then: the output, a gap, the heading, a gap, the errors; the errors
  // alone; or the line that says there is no output.
  expect(await rows('!x', { exitCode: 1, stdout: 'a\nb\n', stderr: 'e\n' })).toBe(2 + 2 + 3 + 1)
  expect(await rows('!y', { exitCode: 1, stdout: '', stderr: 'e\n' })).toBe(2 + 2 + 1)
  expect(await rows('!z', { exitCode: 0, stdout: '' })).toBe(2 + 1)
})

// The test runner's timer, which the engine's types leave out.
const later = (globalThis as unknown as { setTimeout: (run: () => void, ms: number) => unknown }).setTimeout

// Waits until `ready` holds, letting the plugin's steps under way go on meanwhile.
async function until(ready: () => boolean) {
  for (let i = 0; i < 200 && !ready(); i += 1) await new Promise<void>(resolve => later(resolve, 0))
  expect(ready()).toBe(true)
}

test('the pane opens while the command runs, saying so, and fits the output once it ended', async ($, on) => {
  const r = engine(on, {})
  let finish: (run: Run) => void = () => undefined
  r.commands['/bin/sh'] = () => new Promise<Run>(resolve => (finish = resolve))

  const ran = peek($, '!make')
  await until(() => r.opened.length === 1)
  const { header, codes, keyed } = await pane($, 'no-output')
  expect(header).toBe('$ make · running…')
  expect(codes).toEqual([])
  expect(keyed).toBeUndefined()

  finish({ exitCode: 0, stdout: 'a\nb\n' })
  expect((await ran).text).toBe('Opened $ make')
  expect((await pane($)).header).toBe('$ make · exit 0')
  expect(r.opens.map(open => open.rows)).toEqual([2 + 1, 2 + 2])
})

test('Run again keeps the output shown while it runs, and a press meanwhile runs nothing more', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = { exitCode: 0, stdout: 'one\n' }
  await peek($, '!date')
  let finish: (run: Run) => void = () => undefined
  r.commands['/bin/sh'] = () => new Promise<Run>(resolve => (finish = resolve))

  const again = press($, 'rerun')
  await until(() => r.ran.length === 2)
  expect((await pane($)).header).toBe('$ date · running…')
  expect((await pane($)).code?.source).toBe('one\n')
  await press($, 'rerun')
  expect(r.ran).toHaveLength(2)

  finish({ exitCode: 0, stdout: 'one\ntwo\nthree\n' })
  await again
  expect((await pane($)).header).toBe('$ date · exit 0')
  expect(r.opens.at(-1)?.rows).toBe(2 + 3)
})

test('a command run while another runs is the one shown when the first ends', async ($, on) => {
  const r = engine(on, {})
  let finish: (run: Run) => void = () => undefined
  r.commands['/bin/sh'] = () => new Promise<Run>(resolve => (finish = resolve))
  const slow = peek($, '!slow')
  await until(() => r.ran.length === 1)
  r.commands['/bin/sh'] = { exitCode: 0, stdout: 'fast\n' }
  await peek($, '!fast')

  finish({ exitCode: 0, stdout: 'slow\n' })
  await slow
  const { header, code } = await pane($)
  expect(header).toBe('$ fast · exit 0')
  expect(code?.source).toBe('fast\n')
})

test('a command that took a second or more says how long', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = async () => {
    await r.clock.advance(2_400)
    return { exitCode: 0, stdout: 'ok\n' }
  }

  await peek($, '!make')
  expect((await pane($)).header).toBe('$ make · exit 0 · 2 s')
})

test('the pane left for another view while the command ran stays there when it ends', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  let finish: (run: Run) => void = () => undefined
  r.commands['/bin/sh'] = () => new Promise<Run>(resolve => (finish = resolve))
  const ran = peek($, '!make')
  await until(() => r.opened.length === 1)
  await peek($, 'a.md')

  finish({ exitCode: 0, stdout: 'done\n' })
  await ran
  expect((await pane($)).markdown?.text).toBe('a')
  expect(r.opened).toEqual(['$ make', 'a.md'])
})

test('a command that ends while another tab is in front fits the pane without bringing it forward', async ($, on) => {
  const r = engine(on, {})
  let finish: (run: Run) => void = () => undefined
  r.commands['/bin/sh'] = () => new Promise<Run>(resolve => (finish = resolve))
  const ran = peek($, '!make')
  await until(() => r.opened.length === 1)

  r.isShown = false
  finish({ exitCode: 0, stdout: 'a\nb\n' })
  await ran
  expect(r.opens.map(open => [open.rows, open.focus])).toEqual([
    [2 + 1, undefined],
    [2 + 2, undefined],
  ])
})

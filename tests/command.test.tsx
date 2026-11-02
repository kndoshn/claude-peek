import { expect, test } from 'claude-code/testing'

import { autocomplete, button, CWD, engine, pane, peek, press } from './support'

test('/peek !command runs it in the person\'s interactive shell and shows its output', async ($, on) => {
  const r = engine(on, {})
  r.env = { SHELL: '/bin/zsh' }
  r.commands['/bin/zsh'] = { exitCode: 0, stdout: 'a.md\nb.md\n' }

  expect((await peek($, '!ls -la')).text).toBe('Opened $ ls -la')
  expect(r.ran).toEqual([{ argv: ['/bin/zsh', '-ic', 'ls -la'], cwd: CWD, env: { PEEK: '1' }, stdin: '', timeoutMs: 30000 }])
  expect(r.opened).toEqual(['$ ls -la'])
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
  expect(r.ran[0]?.argv).toEqual(['/bin/sh', '-ic', 'echo ok'])
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

test('a view not yet opened says how to open it', async ($, on) => {
  const r = engine(on, {})
  r.commands['/bin/sh'] = { exitCode: 0, stdout: 'out\n' }
  await peek($, '!echo out')

  await press($, 'view:file')
  expect((await pane($, 'hint')).keyed?.text).toBe('/peek [path] shows a file here')
})

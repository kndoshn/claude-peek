import { expect, test } from 'claude-code/testing'

import {
  assistant,
  autocomplete,
  BAND,
  button,
  CWD,
  engine,
  md,
  pane,
  PANE,
  peek,
  press,
  pressPane,
  sessionEnds,
  shown,
  start,
  submit,
  toolResult,
  tracked,
  turnEnds,
  user,
} from './support'
import type { Files, Message } from './support'

test('/md <path> opens the file relative to the working directory', async ($, on) => {
  const r = engine(on, { '/proj/docs/plan.md': '# Plan\n\nBody' })
  await start($)

  expect((await md($, 'docs/plan.md')).text).toBe('Opened docs/plan.md')
  expect(r.opened).toEqual(['plan.md'])
  const { header, headingWrap, markdown } = await pane($)
  expect(header).toBe('docs/plan.md · 3 lines')
  expect(headingWrap).toBe('truncate-start')
  expect(markdown?.text).toBe('# Plan\n\nBody')
})

test('/md expands ~/ and shows a path outside the project from the home', async ($, on) => {
  const r = engine(on, { '/home/me/notes/idea.md': 'idea' })

  await md($, '~/notes/idea.md')
  expect(r.opened).toEqual(['idea.md'])
  expect((await pane($)).header).toBe('~/notes/idea.md · 1 line')
})

test('/md refuses other files and names that match nothing', async ($, on) => {
  const r = engine(on, { '/proj/a.txt': 'x' })
  tracked(r, 'docs/setup.md')

  expect((await md($, 'a.txt')).text).toBe('Not a Markdown file: /proj/a.txt')
  expect((await md($, 'missing.md')).text).toContain('Nothing matches "missing.md"')
  expect((await md($, 'zzz')).text).toContain('Nothing matches "zzz"')
  expect(r.opened).toEqual([])
})

test('/md with part of a name opens the best Markdown match, a file name match first', async ($, on) => {
  const files = { '/proj/docs/ai-agents.md': 'a', '/proj/docs/setup.md': 's', '/proj/README.md': 'r', '/proj/ai.ts': 'x' }
  const r = engine(on, files, [assistant('see docs/ai-agents.md')])
  tracked(r, 'README.md', 'ai.ts', 'docs/ai-agents.md', 'docs/setup.md')

  expect((await md($, 'ai')).text).toBe('Opened docs/ai-agents.md')
  await md($, 'setup')
  expect(r.opened).toEqual(['ai-agents.md', 'setup.md'])
  await md($, 'plan.md')
  expect(r.opened.length).toBe(2)
})

test('the project files come from git, which lists untracked ones and skips ignored ones', async ($, on) => {
  const r = engine(on, { '/proj/docs/new note.md': 'n' })
  tracked(r, 'docs/new note.md')

  await md($, 'note')
  expect(r.opened).toEqual(['new note.md'])
  expect(r.ran.find(run => run.argv[0] === 'git')?.argv).toEqual(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
})

test('outside a git repository the project files come from fd, and without fd from the conversation alone', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a', '/proj/b.md': 'b' }, [assistant('see b.md')])
  r.git = { exitCode: 128, stdout: '' }
  r.fd = { exitCode: 0, stdout: 'a.md\nb.md\n' }

  await md($, 'a')
  expect(r.opened).toEqual(['a.md'])
  expect(r.ran.find(run => run.argv[0] === 'fd')?.argv).toEqual(['fd', '--type', 'f', '--hidden', '--exclude', '.git'])

  r.fd = { exitCode: 127, stdout: '' }
  expect((await md($, 'a')).text).toContain('Nothing matches')
  await md($, 'b')
  expect(r.opened).toEqual(['a.md', 'b.md'])
})

test('/md without a path opens the newest .md named in the conversation', async ($, on) => {
  const files = { '/proj/old.md': 'old', '/proj/docs/new.md': 'new', '/proj/written.md': 'w', '/proj/code.ts': 'c' }
  const messages = [
    assistant('See old.md'),
    user('next'),
    assistant('I wrote it.', [{ tool_use_id: 't', tool: 'Write', input: { file_path: '/proj/written.md' } }]),
    toolResult(),
    assistant('Please review `docs/new.md` and ignored.md, then code.ts'),
  ]
  const r = engine(on, files, messages)

  await md($)
  expect(r.opened).toEqual(['new.md'])
})

test('/md without a path and nothing named says how to name one', async ($, on) => {
  const r = engine(on, {}, [assistant('nothing here')])

  expect((await md($)).text).toContain('/md <path>')
  expect(r.opened).toEqual([])
})

test('/peek opens any text file as numbered source, its language from the path', async ($, on) => {
  const r = engine(on, { '/proj/src/a.ts': 'const a = 1\nconst b = 2\n' })

  expect((await peek($, 'src/a.ts')).text).toBe('Opened src/a.ts')
  expect(r.opened).toEqual(['a.ts'])
  const { code, markdown, header } = await pane($)
  expect(code).toMatchObject({ source: 'const a = 1\nconst b = 2\n', path: '/proj/src/a.ts', startLine: 1 })
  expect(markdown).toBeUndefined()
  expect(header).toBe('src/a.ts · 2 lines')
  // Only Markdown has a rendered view to switch to.
  expect(await button($, 'source')).toBeUndefined()
})

test('/peek path:line opens the source at that line, marked, and scrolls to it', async ($, on) => {
  const text = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join('\n')
  const r = engine(on, { '/proj/a.md': text })

  await peek($, 'a.md:3-4')
  const { codes, header } = await pane($, 'peek-line')
  expect(codes.map(code => [code.startLine, code.source])).toEqual([
    [1, 'line 1\nline 2'],
    [3, 'line 3\nline 4'],
    [5, 'line 5\nline 6'],
  ])
  expect(header).toBe('a.md · 6 lines · source · lines 3-4')
  expect(r.opened).toEqual(['a.md'])
  // The view a line opens is the source, so Rendered switches back.
  expect(await button($, 'source')).toBe('Rendered')

  await peek($, 'a.md:1')
  expect((await pane($)).codes.map(code => code.startLine)).toEqual([1, 2])
})

test('/peek refuses a binary file', async ($, on) => {
  const r = engine(on, { '/proj/logo.png': '\u0089PNG\u0000\u0000' })

  expect((await peek($, 'logo.png')).text).toBe('Not a text file: /proj/logo.png')
  expect(r.opened).toEqual([])
})

test('/peek with part of a name looks through every file, the conversation first', async ($, on) => {
  const files = { '/proj/hooks/register.tsx': 'r', '/proj/docs/registry.md': 'd' }
  const r = engine(on, files, [assistant('I edited docs/registry.md')])
  tracked(r, 'hooks/register.tsx', 'docs/registry.md')

  await peek($, 'register')
  expect(r.opened).toEqual(['register.tsx'])
  await peek($, 'regist')
  expect(r.opened).toEqual(['register.tsx', 'registry.md'])
  // A line after part of a name goes with the match.
  await peek($, 'register:1')
  expect((await pane($, 'peek-line')).keyed).toBeDefined()
})

test('/peek without a target opens the working directory, then the last place shown', async ($, on) => {
  const files = { '/proj/src/a.ts': 'a', '/proj/b.md': 'b' }
  const r = engine(on, files, [assistant('See b.md')])

  await peek($)
  expect(r.opened).toEqual(['proj/'])
  await md($, 'b.md')
  await press($, 'close')
  await peek($)
  expect(r.opened).toEqual(['proj/', 'b.md', 'b.md'])
})

test('the band inserts the shown file as an @ mention after the draft', async ($, on) => {
  const r = engine(on, { '/proj/src/a.ts': 'a', '/home/me/x.md': 'x' })
  await peek($, 'src/a.ts')
  r.draft = 'Look at'

  await press($, 'mention')
  expect(r.filled).toEqual([{ text: ' @src/a.ts ', mode: 'append' }])
  await peek($, '~/x.md')
  await press($, 'mention')
  expect(r.filled[1]?.text).toBe('@~/x.md ')
})

test('the band quotes the selection after the draft, headed by the file and its lines', async ($, on) => {
  const source = '# Plan\n\nThe **first** step.\n\n- see [docs](docs/a.md)\n- second item\n'
  const r = engine(on, { '/proj/a.md': source })
  await md($, 'a.md')
  r.draft = 'Comments:'
  r.selection = { text: 'The first step.\n\n• see docs\n' }

  await press($, 'quote')
  expect(r.filled).toEqual([{ text: '\n\na.md:3-5\n> The first step.\n>\n> • see docs\n\n', mode: 'append' }])
})

test('a quote of one line names that line, and an empty draft gets no leading gap', async ($, on) => {
  const r = engine(on, { '/proj/a.md': '# Title\n\nonly line here\n' })
  await md($, 'a.md')
  r.selection = { text: 'only line here' }

  await press($, 'quote')
  expect(r.filled).toEqual([{ text: 'a.md:3\n> only line here\n\n', mode: 'append' }])
})

test('a quote whose lines run across a wrapped line and repeat earlier text finds the passage', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'intro\n\nsame words\n\nsame words and a very long line\nthat ends here\n' })
  await md($, 'a.md')
  r.selection = { text: 'same words\nand a very long line\nthat ends' }

  await press($, 'quote')
  expect(r.filled[0]?.text).toBe('a.md:5-6\n> same words\n> and a very long line\n> that ends\n\n')
})

test('a quote that cannot be found in the file is headed by the file alone', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'something else' })
  await md($, 'a.md')
  r.selection = { text: 'not there' }

  await press($, 'quote')
  expect(r.filled[0]?.text).toBe('a.md\n> not there\n\n')
})

test('a selection in the conversation is quoted without a heading', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'reply text' })
  await md($, 'a.md')
  r.selection = { text: 'reply text', requestId: 'message-1' }

  await press($, 'quote')
  expect(r.filled[0]?.text).toBe('> reply text\n\n')
})

test('quoting without a selection tells the person and fills nothing', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  await md($, 'a.md')

  await press($, 'quote')
  expect(r.filled).toEqual([])
  expect(r.toasts).toEqual(['Select a passage in the pane with the mouse first'])
})

test('a quote taken from the numbered source view drops the numbers and keeps the lines', async ($, on) => {
  const source = '# Plan\n\nThe **first** step.\n\n- see [docs](docs/a.md)\n'
  const r = engine(on, { '/proj/a.md': source })
  await md($, 'a.md')
  await press($, 'source')
  r.selection = { text: '  3 │ The **first** step.\n  4 │\n  5 │ - see [docs](docs/a.md)' }

  await press($, 'quote')
  expect(r.filled[0]?.text).toBe('a.md:3-5\n> The **first** step.\n>\n> - see [docs](docs/a.md)\n\n')
})

test('a number that starts a line of the rendered view stays in the quote', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a\nb\n3 things\n' })
  await md($, 'a.md')
  r.selection = { text: '3 things' }

  await press($, 'quote')
  expect(r.filled[0]?.text).toBe('a.md:3\n> 3 things\n\n')
})

test('numbers that do not match the file stay in the quote', async ($, on) => {
  const r = engine(on, { '/proj/a.md': '# Steps\n\n1. one\n2. two\n' })
  await md($, 'a.md')
  r.selection = { text: '1. one\n2. two' }

  await press($, 'quote')
  expect(r.filled[0]?.text).toBe('a.md:3-4\n> 1. one\n> 2. two\n\n')
})

test('a change to the open file, by Claude or anything else, redraws the pane', async ($, on) => {
  const files: Files = { '/proj/a.md': 'before' }
  const r = engine(on, files)
  await start($)
  await md($, 'a.md')

  files['/proj/a.md'] = 'after'
  await r.clock.advance(1000)
  // Same modification time: nothing to read again.
  expect(await shown($)).toBe('before')

  r.mtimes['/proj/a.md'] = 5
  await r.clock.advance(1000)
  expect(await shown($)).toBe('after')

  // A file that went away keeps what was shown, marked as gone until it comes back.
  delete files['/proj/a.md']
  await r.clock.advance(1000)
  expect(await shown($)).toBe('after')
  expect((await pane($)).header).toContain('deleted')

  files['/proj/a.md'] = 'back'
  r.mtimes['/proj/a.md'] = 9
  await r.clock.advance(1000)
  expect(await shown($)).toBe('back')
  expect((await pane($)).header).not.toContain('deleted')

  // A file there that cannot be shown any more (too large, binary) keeps what was shown, not
  // marked as gone.
  files['/proj/a.md'] = 'x'.repeat(4 * 1024 * 1024 + 1)
  r.mtimes['/proj/a.md'] = 12
  await r.clock.advance(1000)
  expect(await shown($)).toBe('back')
  expect((await pane($)).header).not.toContain('deleted')
})

test('a file gone from the disk is still there to go back to, from the band or /peek, marked as gone', async ($, on) => {
  const files: Files = { '/proj/a.md': 'kept', '/proj/b.md': 'b', '/proj/c.txt': 'c' }
  const r = engine(on, files)
  await start($)
  await md($, 'a.md')
  delete files['/proj/a.md']
  await r.clock.advance(1000)

  await press($, 'view:tree')
  await press($, 'view:file')
  expect(r.toasts).toEqual([])
  expect(await shown($)).toBe('kept')
  expect((await pane($)).header).toContain('deleted')

  await press($, 'close')
  expect((await peek($)).text).toBe('Opened a.md')
  expect((await pane($)).header).toContain('deleted')

  // Opened before it went and seen gone only now, it is marked too.
  await md($, 'b.md')
  delete files['/proj/b.md']
  await press($, 'view:tree')
  await press($, 'view:file')
  expect(r.toasts).toEqual([])
  expect((await pane($)).header).toContain('deleted')
})

test('control characters in a file show as their pictures, in every view of it and in its name', async ($, on) => {
  const files: Files = {
    '/proj/build.txt': 'build \u001b[32mok\u001b[0m\npage\fbreak\n',
    '/proj/notes.md': '---\r\ntitle: Notes\r\n---\r\n# Notes\u0007\r\n',
    '/proj/odd\u001bname.txt': 'x',
  }
  const r = engine(on, files)
  await start($)

  await peek($, 'build.txt')
  expect((await pane($)).code?.source).toBe('build ␛[32mok␛[0m\npage␌break\n')
  await peek($, 'build.txt:2')
  expect((await pane($)).codes.map(code => code.source)).toEqual(['build ␛[32mok␛[0m', 'page␌break'])
  files['/proj/build.txt'] = 'build \u001b[31mfail\u001b[0m\npage\fbreak\n'
  r.mtimes['/proj/build.txt'] = 5
  await r.clock.advance(1000)
  await press($, 'changes')
  expect((await pane($)).code?.source).toContain('+build ␛[31mfail␛[0m')

  // Line endings of CRLF read as lines, so the front matter is found.
  await md($, 'notes.md')
  expect(await shown($)).toBe('```yaml\ntitle: Notes\n```\n# Notes␇\n')
  expect((await pane($)).header).toBe('notes.md · 4 lines')

  await peek($, 'odd\u001bname.txt')
  expect(r.opened.at(-1)).toBe('odd␛name.txt')
  expect((await pane($)).header).toBe('odd␛name.txt · 1 line')
})

test('the source view shows the Markdown as written, numbered by line, and toggles back', async ($, on) => {
  engine(on, { '/proj/a.md': '# A\n\n**b**\n' })
  await md($, 'a.md')
  expect(await button($, 'source')).toBe('Source')

  await press($, 'source')
  const { code, markdown, header } = await pane($)
  expect(code).toMatchObject({ source: '# A\n\n**b**\n', path: '/proj/a.md', startLine: 1 })
  expect(markdown).toBeUndefined()
  expect(header).toContain('source')
  expect(await button($, 'source')).toBe('Rendered')

  await press($, 'source')
  expect(await shown($)).toBe('# A\n\n**b**\n')
})

test('changes since the last prompt show as a diff, and the next prompt starts over', async ($, on) => {
  const files: Files = { '/proj/a.ts': 'one\ntwo\nthree\n' }
  const r = engine(on, files)
  await start($)
  await peek($, 'a.ts')
  expect(await button($, 'changes')).toBeUndefined()

  files['/proj/a.ts'] = 'one\n2\nthree\nfour\n'
  r.mtimes['/proj/a.ts'] = 1
  await r.clock.advance(1000)
  expect(await button($, 'changes')).toBe('Changes +2 −1')

  await press($, 'changes')
  const { code, header } = await pane($)
  expect(code).toMatchObject({ format: 'diff', source: '@@ -1,3 +1,4 @@\n one\n-two\n+2\n three\n+four\n' })
  expect(header).toContain('changes')
  expect(await button($, 'changes')).toBe('Hide changes')

  // A slash command is no new message; a prompt is, and the file as it stands becomes the base.
  await submit($, '/md', 'md')
  expect(await button($, 'changes')).toBe('Hide changes')
  await submit($, 'thanks')
  expect(await button($, 'changes')).toBeUndefined()
  expect((await pane($)).code?.source).toBe('one\n2\nthree\nfour\n')
})

test('opening the file that is open keeps its changes and its view', async ($, on) => {
  const files: Files = { '/proj/a.md': 'one\n' }
  const r = engine(on, files)
  await start($)
  await md($, 'a.md')
  await press($, 'source')
  files['/proj/a.md'] = 'one\ntwo\n'
  r.mtimes['/proj/a.md'] = 1
  await r.clock.advance(1000)

  await md($, 'a.md')
  expect(await button($, 'changes')).toBe('Changes +1 −0')
  expect(await button($, 'source')).toBe('Rendered')
})

test('a relative link to a Markdown file opens it in the pane, and Back returns', async ($, on) => {
  const files = {
    '/proj/docs/guide/index.md': 'See [setup](../setup.md#install), ![img](pic.md), `[x](code.md)` and [web](https://example.com).',
    '/proj/docs/setup.md': '# Setup',
  }
  const r = engine(on, files)
  await md($, 'docs/guide/index.md')

  const { markdown } = await pane($)
  expect(markdown?.text).toBe(
    'See [setup](file:///proj/docs/setup.md), ![img](pic.md), `[x](code.md)` and [web](https://example.com).',
  )
  expect(markdown?.pressableLinks).toEqual(['file:///proj/docs/setup.md'])

  await pressPane($, 'doc', 'file:///proj/docs/setup.md')
  expect(r.opened).toEqual(['index.md', 'setup.md'])
  expect(await shown($)).toBe('# Setup')

  expect(await button($, 'back')).toBe('← Back')
  await press($, 'back')
  expect(r.opened).toEqual(['index.md', 'setup.md', 'index.md'])
  expect(await button($, 'back')).toBeUndefined()
})

test('a relative link to another file opens it at the lines of its anchor, and one to a folder opens the tree', async ($, on) => {
  const files = {
    '/proj/docs/index.md': 'See [the parser](../src/a.ts#L2-L3) in [src](../src/).',
    '/proj/src/a.ts': 'one\ntwo\nthree\nfour',
  }
  const r = engine(on, files)
  await md($, 'docs/index.md')
  expect((await pane($)).markdown?.pressableLinks).toEqual(['file:///proj/src/a.ts#L2-L3', 'file:///proj/src'])

  await pressPane($, 'doc', 'file:///proj/src/a.ts#L2-L3')
  expect((await pane($)).header).toBe('src/a.ts · 4 lines · lines 2-3')
  await press($, 'back')
  await pressPane($, 'doc', 'file:///proj/src')
  expect((await pane($)).header).toBe('/proj/src')
  expect(r.toasts).toEqual([])
})

test('a link to a file that does not exist says so and stays', async ($, on) => {
  const r = engine(on, { '/proj/a.md': '[gone](gone%20file.md)' })
  await md($, 'a.md')

  await pressPane($, 'doc', 'file:///proj/gone%20file.md')
  expect(r.opened).toEqual(['a.md'])
  expect(r.toasts).toEqual(['Cannot read /proj/gone file.md'])
  expect(await button($, 'back')).toBeUndefined()
})

test('while another tab is shown in front of the pane, the band keeps the views, quoting and Close, and drops what acts on the view', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  await start($)
  await md($, 'a.md')
  expect(await button($, 'source')).toBe('Source')

  r.isShown = false
  await r.clock.advance(1000)
  expect(await button($, 'source')).toBeUndefined()
  expect(await button($, 'view:file')).toBe('File')
  expect(await button($, 'quote')).toBe('Quote selection')
  expect(await button($, 'close')).toBe('Close')

  r.isShown = true
  await r.clock.advance(1000)
  expect(await button($, 'source')).toBe('Source')
})

test('a command or a view button brings the pane in front of another tab; only then does the open take the focus', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a', '/proj/b.md': 'b' })
  await md($, 'a.md')
  expect(r.opens.at(-1)?.focus).toBeUndefined()

  // Brought in front, the pane is given a moment to be laid out there before the scroll.
  const settled = async (step: Promise<unknown>) => {
    let done = false
    void step.then(() => (done = true))
    for (let i = 0; i < 100 && !done; i += 1) await r.clock.advance(50)
    expect(done).toBe(true)
  }
  r.isShown = false
  await settled(md($, 'b.md'))
  expect(r.opens.at(-1)?.focus).toBe(true)
  r.isShown = false
  await settled(press($, 'view:file'))
  expect(r.opens.at(-1)?.focus).toBe(true)
  r.isShown = false
  await settled(peek($))
  expect(r.opens.at(-1)?.focus).toBe(true)
})

test('front matter is drawn as a YAML block', async ($, on) => {
  engine(on, { '/proj/SKILL.md': '---\nname: x\n---\n# X\n' })
  await md($, 'SKILL.md')

  expect(await shown($)).toBe('```yaml\nname: x\n```\n# X\n')
})

test('a file too long to draw is cut, and the header says so', async ($, on) => {
  engine(on, { '/proj/big.md': `${'x'.repeat(99)}\n`.repeat(2000) })
  await md($, 'big.md')

  const { markdown, header } = await pane($)
  expect(String(markdown?.text).length).toBeLessThanOrEqual(90000)
  expect(header).toContain('cut')
})

test('closing the pane clears the band', async ($, on) => {
  engine(on, { '/proj/a.md': 'a' })
  await md($, 'a.md')
  await press($, 'close')

  expect(await button($, 'quote')).toBeUndefined()
})

test('the pane opens to be read: closed by Escape, 100 columns docked, inline as tall as the file', async ($, on) => {
  const r = engine(on, { '/proj/short.md': 'one\ntwo\n', '/proj/b.md': '[b](short.md)' })
  await md($, 'short.md')
  await md($, 'b.md')
  await pressPane($, 'doc', 'file:///proj/short.md')

  expect(r.opens.map(open => [open.id, open.closeOnEscape, open.columns, open.rows])).toEqual([
    ['peek', true, 100, 4],
    ['peek', true, 100, 3],
    ['peek', true, 100, 4],
  ])
})

test('a /clear or a resume closes the pane, as the next conversation starts its state over; leaving does not', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  await md($, 'a.md')
  await sessionEnds($, 'prompt_input_exit')
  expect(r.closed).toEqual([])

  await sessionEnds($, 'clear')
  expect(r.closed).toEqual(['peek'])
  expect(await button($, 'quote')).toBeUndefined()

  await md($, 'a.md')
  await sessionEnds($, 'resume')
  expect(r.closed).toEqual(['peek', 'peek'])
  // A closed pane is not closed again.
  await sessionEnds($, 'clear')
  expect(r.closed).toEqual(['peek', 'peek'])
})

test("in a dark theme the pane takes the terminal's background, in a light one the theme's", async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.config = [{ key: 'theme', value: 'dark-ansi' }]
  await md($, 'a.md')
  r.config = [{ key: 'theme', value: 'light' }]
  await md($, 'a.md')

  expect(r.opens.map(open => open.backgroundColor)).toEqual(['transparent', undefined])
})

test('a reply naming a .md offers it in the band, and the offer opens or goes away', { options: { offerReplies: true } }, async ($, on) => {
  const messages: Message[] = [user('write a plan'), assistant('Wrote docs/plan.md, please review.')]
  const r = engine(on, { '/proj/docs/plan.md': 'plan' }, messages)
  await turnEnds($)

  expect(await button($, 'offer')).toBe('Open docs/plan.md')
  await press($, 'offer')
  expect(r.opened).toEqual(['plan.md'])
  expect(await button($, 'offer')).toBeUndefined()

  messages.push(user('and another'), assistant('Also see notes.md'))
  await press($, 'close')
  await turnEnds($)
  expect(await button($, 'offer')).toBeUndefined()
})

test('without the setting, a reply naming a .md or citing lines offers nothing', async ($, on) => {
  engine(on, { '/proj/docs/plan.md': 'plan', '/proj/src/a.ts': 'one\ntwo' }, [user('go'), assistant('Wrote docs/plan.md. The bug is at src/a.ts:1-2.')])
  await turnEnds($)

  expect(await button($, 'offer')).toBeUndefined()
  expect(await button($, 'dismiss')).toBeUndefined()
})

test('the offer can be dismissed, and opening another file keeps it', { options: { offerReplies: true } }, async ($, on) => {
  engine(on, { '/proj/a.md': 'a', '/proj/b.md': 'b' }, [user('go'), assistant('done: a.md')])
  await turnEnds($)

  await md($, 'b.md')
  expect(await button($, 'offer')).toBe('Open a.md')
  await press($, 'dismiss')
  expect(await button($, 'offer')).toBeUndefined()
})

test('a reply citing lines of a file offers them in the band, which opens the file there', { options: { offerReplies: true } }, async ($, on) => {
  const code = 'one\ntwo\nthree\nfour'
  const messages: Message[] = [user('why?'), assistant('Edited src/b.ts. The bug is at src/a.ts:2-3.')]
  engine(on, { '/proj/src/a.ts': code, '/proj/src/b.ts': code }, messages)
  await turnEnds($)

  expect(await button($, 'offer')).toBe('Open src/a.ts:2-3')
  await press($, 'offer')
  expect((await pane($)).header).toBe('src/a.ts · 4 lines · lines 2-3')
  expect(await button($, 'offer')).toBeUndefined()

  // Shown at those lines, it is not offered again; at others, it is, until opened there.
  await turnEnds($)
  expect(await button($, 'offer')).toBeUndefined()
  await peek($, 'src/a.ts')
  await turnEnds($)
  expect(await button($, 'offer')).toBe('Open src/a.ts:2-3')
  await peek($, 'src/a.ts:2-3')
  expect(await button($, 'offer')).toBeUndefined()

  // A file named without lines is not offered, unless it is Markdown.
  messages.push(user('and?'), assistant('Edited src/b.ts.'))
  await turnEnds($)
  expect(await button($, 'offer')).toBeUndefined()
})

test('a reply naming no .md since the last prompt offers nothing', { options: { offerReplies: true } }, async ($, on) => {
  engine(on, { '/proj/a.md': 'a' }, [assistant('see a.md'), user('thanks'), assistant('ok')])
  await turnEnds($)

  expect(await button($, 'offer')).toBeUndefined()
})

test('a band already drawn redraws when the shown file changes', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'one\n' })
  await md($, 'a.md')

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'source' })
  expect((await ui.find({ key: 'source' }))?.text).toBe('Rendered')
  r.selection = { text: 'one' }
  await ui.press({ key: 'quote' })
  expect(r.filled[0]?.text).toBe('a.md:1\n> one\n\n')
  await ui.unmount()
})

test('/md arguments complete to Markdown files, /peek arguments to every file', async ($, on) => {
  const r = engine(on, { '/proj/docs/ai-agents.md': 'x' }, [assistant('see docs/ai-agents.md')])
  tracked(r, 'README.md', 'docs/ai-agents.md', 'docs/setup.md', 'src/agent.ts')

  const texts = async (text: string) => (await autocomplete($, text)).suggestions.map(s => s.text)
  expect(await texts('/md ag')).toEqual(['docs/ai-agents.md'])
  expect(await texts('/md d')).toEqual(['docs/ai-agents.md', 'README.md', 'docs/setup.md'])
  expect(await texts('/peek ag')).toEqual(['docs/ai-agents.md', 'src/agent.ts'])
})

test('/peek completes to the lines a reply cited, the newest first, and a name opens at the first; /md leaves them out', async ($, on) => {
  const code = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n')
  const files = { '/proj/hooks/find.ts': code, '/proj/docs/plan.md': '# Plan' }
  const r = engine(on, files, [assistant('See hooks/find.ts:3 and docs/plan.md:1'), assistant('The bug is at hooks/find.ts:5-6.')])
  tracked(r, 'hooks/find.ts', 'docs/plan.md')

  const result = await autocomplete($, '/peek find')
  expect(result.suggestions.map(s => s.text)).toEqual(['hooks/find.ts:5-6', 'hooks/find.ts:3', 'hooks/find.ts'])
  expect(result.suggestions[0]).toEqual({ text: 'hooks/find.ts:5-6', label: 'find.ts:5-6', description: 'hooks' })
  expect((await autocomplete($, '/md plan')).suggestions.map(s => s.text)).toEqual(['docs/plan.md'])

  await peek($, 'find')
  expect((await pane($)).header).toBe('hooks/find.ts · 8 lines · lines 5-6')
  // Lines typed win, and a path typed whole opens the file from its top.
  await peek($, 'find:2')
  expect((await pane($)).header).toBe('hooks/find.ts · 8 lines · line 2')
  await peek($, 'hooks/find.ts')
  expect((await pane($)).header).toBe('hooks/find.ts · 8 lines')
})

test('a suggestion shows the file name, and beside it the folder when there is one', async ($, on) => {
  const r = engine(on, {})
  tracked(r, 'README.md', 'docs/README.md')

  const result = await autocomplete($, '/md READ')
  expect(result.suggestions).toEqual([
    { text: 'README.md', label: 'README.md' },
    { text: 'docs/README.md', label: 'README.md', description: 'docs' },
  ])
})

test('autocomplete leaves other prompts alone', async ($, on) => {
  const r = engine(on, {})
  tracked(r, 'README.md')

  expect((await autocomplete($, 'read REA')).suggestions).toEqual([])
})

test('completion lists the files once for a few seconds, while a command lists them afresh', async ($, on) => {
  const r = engine(on, { '/proj/docs/setup.md': 's' }, [assistant('see docs/setup.md')])
  tracked(r, 'docs/setup.md')
  const listed = () => r.ran.filter(run => run.argv[0] === 'git').length

  await autocomplete($, '/md s')
  await autocomplete($, '/peek se')
  expect(listed()).toBe(1)
  expect(r.messageReads).toBe(1)

  await r.clock.advance(5000)
  await autocomplete($, '/md set')
  expect(listed()).toBe(2)

  await md($, 'setup')
  expect(listed()).toBe(3)
})

test('the language option set to ja speaks Japanese', { options: { language: 'ja' } }, async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.config = [{ key: 'language', value: 'english' }]

  expect((await md($, 'a.md')).text).toBe('a.md をパネルで開きました')
  expect((await md($, 'zzz')).text).toContain('見つかりません: zzz')
  expect(await button($, 'quote')).toBe('選択を引用')
})

test("auto follows Claude Code's language setting, then the locale", async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.config = [{ key: 'language', value: 'Japanese' }]
  expect((await md($, 'a.md')).text).toBe('a.md をパネルで開きました')
})

test('auto falls back to the locale', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.env = { LANG: 'ja_JP.UTF-8' }
  expect((await md($, 'a.md')).text).toBe('a.md をパネルで開きました')
})

test('the language option set to en speaks English whatever the settings say', { options: { language: 'en' } }, async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.config = [{ key: 'language', value: 'japanese' }]
  r.env = { LANG: 'ja_JP.UTF-8' }
  expect((await md($, 'a.md')).text).toBe('Opened a.md')
})

test('a file outside the working directory stays labelled from the home', async ($, on) => {
  engine(on, { [`${CWD}/../elsewhere/z.md`]: 'z', '/elsewhere/z.md': 'z' })
  await md($, '/elsewhere/z.md')
  expect((await pane($)).header).toBe('/elsewhere/z.md · 1 line')
})

test('a pane state an earlier version kept, on a view this one has not, reads as a closed pane', async ($, on) => {
  engine(on, {})
  // nav-1 could hold the command view, in the pane and in Back.
  on('state.get', (_, e, next) =>
    e.plugin === 'peek' && e.key === 'nav'
      ? { value: { value: { shape: 'nav-1', value: { isOpen: true, view: 'command', back: [{ view: 'command' }] } }, version: 1 } }
      : next(e),
  )

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /\/peek \[path\]/ }))?.text).toBe('/peek [path] shows a file here')
  await ui.unmount()
})

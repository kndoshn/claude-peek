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
  peek,
  press,
  pressPane,
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

test('a link to a file that does not exist says so and stays', async ($, on) => {
  const r = engine(on, { '/proj/a.md': '[gone](gone%20file.md)' })
  await md($, 'a.md')

  await pressPane($, 'doc', 'file:///proj/gone%20file.md')
  expect(r.opened).toEqual(['a.md'])
  expect(r.toasts).toEqual(['Cannot read /proj/gone file.md'])
  expect(await button($, 'back')).toBeUndefined()
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

test("in a dark theme the pane takes the terminal's background, in a light one the theme's", async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.config = [{ key: 'theme', value: 'dark-ansi' }]
  await md($, 'a.md')
  r.config = [{ key: 'theme', value: 'light' }]
  await md($, 'a.md')

  expect(r.opens.map(open => open.backgroundColor)).toEqual(['transparent', undefined])
})

test('a reply naming a .md offers it in the band, and the offer opens or goes away', async ($, on) => {
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

test('the offer can be dismissed, and opening another file keeps it', async ($, on) => {
  engine(on, { '/proj/a.md': 'a', '/proj/b.md': 'b' }, [user('go'), assistant('done: a.md')])
  await turnEnds($)

  await md($, 'b.md')
  expect(await button($, 'offer')).toBe('Open a.md')
  await press($, 'dismiss')
  expect(await button($, 'offer')).toBeUndefined()
})

test('a reply naming no .md since the last prompt offers nothing', async ($, on) => {
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

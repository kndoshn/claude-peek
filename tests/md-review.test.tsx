import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptAutocompleteInput, PromptAutocompleteResult } from 'claude-code'

const CWD = '/proj'
const HOME = '/home/me'

type Files = Record<string, string>
type Message = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool_use_id: string; tool: string; input: Record<string, unknown> }[]
  toolResults?: { tool_use_id: string; text: string; isError: boolean }[]
}
type Run = { exitCode: number; stdout: string }

function assistant(text: string, toolUses: Message['toolUses'] = []): Message {
  return { role: 'assistant', text, toolUses }
}
function user(text: string): Message {
  return { role: 'user', text, toolUses: [] }
}
function toolResult(): Message {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't', text: 'ok', isError: false }] }
}

// What the engine answers beneath the plugin. `files`, `mtimes` and `messages` may change during
// a test; a file's modification time is 0 until `mtimes` says otherwise.
function engine(on: On, files: Files, messages: Message[] = []) {
  const record = {
    clock: mock.clock(on),
    opened: [] as string[],
    closed: [] as string[],
    filled: [] as { text: string; mode?: string }[],
    toasts: [] as string[],
    selection: undefined as { text: string } | undefined,
    draft: '',
    mtimes: {} as Record<string, number>,
    env: {} as Record<string, string>,
    config: [] as { key: string; value: string }[],
    // The project's Markdown files as git and fd list them; fd is missing until a test sets it.
    git: { exitCode: 0, stdout: '' } as Run,
    fd: { exitCode: 127, stdout: '' } as Run,
    ran: [] as string[][],
  }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    record.opened.push(e.title ?? e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    record.closed.push(e.id)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: CWD }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : record.env[e.name] }))
  on('config.list', () => ({
    value: record.config.map(row => ({
      ...row,
      label: row.key,
      kind: 'text' as const,
      provider: { plugin: 'engine', tier: 'core' as const },
      isLocked: false,
    })),
  }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.stat', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file' as const, size: text.length, mtimeMs: record.mtimes[e.path] ?? 0, isLink: false } }
  })
  on('session.messages', () => ({ value: messages }))
  on('ui.selection', () => ({ value: record.selection }))
  on('prompt.read', () => ({ value: { text: record.draft, cursor: record.draft.length } }))
  on('prompt.fill', (_, e) => {
    record.filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('ui.toast', (_, e) => {
    record.toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    record.ran.push([...e.argv])
    const run = e.argv[0] === 'git' ? record.git : e.argv[0] === 'fd' ? record.fd : { exitCode: 127, stdout: '' }
    return { value: { ...run, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.autocomplete', () => ({ suggestions: [] }))
  // The engine's own drawing, where the plugin draws nothing.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  return record
}

// The project's Markdown files as `git ls-files -z` prints them.
function tracked(record: { git: Run }, ...paths: string[]) {
  record.git = { exitCode: 0, stdout: paths.map(path => `${path}\0`).join('') }
}

const PANE = {
  plugin: 'md-review',
  component: 'Pane',
  requestId: 'md-review',
  surface: 'terminal',
  props: {
    title: 'md',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'md-review',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

async function md($: Engine, args = '') {
  return $.command.run({
    command: 'md',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
}

// prompt.autocomplete is raised by the engine alone, so the test engine's typing leaves it out;
// it still runs the chain.
async function autocomplete($: Engine, e: PromptAutocompleteInput): Promise<PromptAutocompleteResult> {
  const prompt = $.prompt as unknown as {
    autocomplete: (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult>
  }
  return prompt.autocomplete(e)
}

async function turnEnds($: Engine) {
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' })
}

async function start($: Engine) {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
}

async function shown($: Engine): Promise<string | undefined> {
  const ui = await $.ui.mount(PANE)
  const text = (await ui.find({ type: 'Markdown' }))?.props.text
  await ui.unmount()
  return typeof text === 'string' ? text : undefined
}

// Presses a button of the band.
async function press($: Engine, key: string) {
  const ui = await $.ui.mount(BAND)
  await ui.press({ key })
  await ui.unmount()
}

// The label of a button of the band, or undefined while it is not drawn.
async function button($: Engine, key: string): Promise<string | undefined> {
  const ui = await $.ui.mount(BAND)
  const found = await ui.find({ key })
  await ui.unmount()
  return found?.text
}

// What the pane draws: its texts, and the props of its Markdown or Code element.
async function pane($: Engine) {
  const ui = await $.ui.mount(PANE)
  const markdown = (await ui.find({ type: 'Markdown' }))?.props
  const code = (await ui.find({ type: 'Code' }))?.props
  const header = (await ui.find({ key: 'header' }))?.text
  await ui.unmount()
  return { markdown, code, header }
}

async function quote($: Engine) {
  await press($, 'quote')
}

async function closePane($: Engine) {
  await press($, 'close')
}

async function submit($: Engine, text: string, command?: string) {
  await $.prompt.submit({
    text,
    wait: false,
    origin: { kind: 'composer' },
    ...(command ? { command: { name: command, args: '' } } : {}),
  })
}

test('/md <path> opens the file relative to the working directory', async ($, on) => {
  const files = { '/proj/docs/plan.md': '# Plan\n\nBody' }
  const r = engine(on, files)
  await start($)

  const result = await md($, 'docs/plan.md')
  expect(result.text).toBe('Opened docs/plan.md')
  expect(r.opened).toEqual(['plan.md'])

  const { header, markdown } = await pane($)
  expect(header).toBe('docs/plan.md · 3 lines')
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
  expect((await md($, 'missing.md')).text).toContain('No Markdown file matches "missing.md"')
  expect((await md($, 'zzz')).text).toContain('No Markdown file matches "zzz"')
  expect(r.opened).toEqual([])
})

test('/md with part of a name opens the best match, a file name match first', async ($, on) => {
  const files = { '/proj/docs/ai-agents.md': 'a', '/proj/docs/setup.md': 's', '/proj/README.md': 'r' }
  const r = engine(on, files, [assistant('see docs/ai-agents.md')])
  tracked(r, 'README.md', 'docs/ai-agents.md', 'docs/setup.md')

  const result = await md($, 'ai')
  expect(r.opened).toEqual(['ai-agents.md'])
  expect(result.text).toBe('Opened docs/ai-agents.md')

  await md($, 'setup')
  // "setup" is in setup.md's name; ai-agents.md, named in the conversation, only matches loosely.
  expect(r.opened).toEqual(['ai-agents.md', 'setup.md'])

  await md($, 'plan.md')
  expect(r.opened.length).toBe(2)
})

test('the project files come from git, which lists untracked ones and skips ignored ones', async ($, on) => {
  const r = engine(on, { '/proj/docs/new note.md': 'n' })
  tracked(r, 'docs/new note.md')

  await md($, 'note')
  expect(r.opened).toEqual(['new note.md'])
  const git = r.ran.find(argv => argv[0] === 'git')
  expect(git).toEqual(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md', '*.markdown'])
})

test('outside a git repository the project files come from fd, and without fd from the conversation alone', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a', '/proj/b.md': 'b' }, [assistant('see b.md')])
  r.git = { exitCode: 128, stdout: '' }
  r.fd = { exitCode: 0, stdout: 'a.md\nb.md\n' }

  await md($, 'a')
  expect(r.opened).toEqual(['a.md'])

  r.fd = { exitCode: 127, stdout: '' }
  expect((await md($, 'a')).text).toContain('No Markdown file matches')
  await md($, 'b')
  expect(r.opened).toEqual(['a.md', 'b.md'])
})

test('/md without a path opens the newest .md named in the conversation', async ($, on) => {
  const files = { '/proj/old.md': 'old', '/proj/docs/new.md': 'new', '/proj/written.md': 'w' }
  const messages = [
    assistant('See old.md'),
    user('next'),
    assistant('I wrote it.', [{ tool_use_id: 't', tool: 'Write', input: { file_path: '/proj/written.md' } }]),
    toolResult(),
    assistant('Please review `docs/new.md` and ignored.md'),
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

test('the band quotes the selection after the draft, headed by the file and its lines', async ($, on) => {
  const source = '# Plan\n\nThe **first** step.\n\n- see [docs](docs/a.md)\n- second item\n'
  const r = engine(on, { '/proj/a.md': source })
  await md($, 'a.md')
  r.draft = 'Comments:'
  r.selection = { text: 'The first step.\n\n• see docs\n' }

  await quote($)
  expect(r.filled).toEqual([{ text: '\n\na.md:3-5\n> The first step.\n>\n> • see docs\n\n', mode: 'append' }])
})

test('a quote of one line names that line, and an empty draft gets no leading gap', async ($, on) => {
  const r = engine(on, { '/proj/a.md': '# Title\n\nonly line here\n' })
  await md($, 'a.md')
  r.selection = { text: 'only line here' }

  await quote($)
  expect(r.filled).toEqual([{ text: 'a.md:3\n> only line here\n\n', mode: 'append' }])
})

test('a quote whose lines run across a wrapped line and repeat earlier text finds the passage', async ($, on) => {
  const source = 'intro\n\nsame words\n\nsame words and a very long line\nthat ends here\n'
  const r = engine(on, { '/proj/a.md': source })
  await md($, 'a.md')
  // The pane wrapped line 5 after "words", which is also all of line 3.
  r.selection = { text: 'same words\nand a very long line\nthat ends' }

  await quote($)
  expect(r.filled[0]?.text).toBe('a.md:5-6\n> same words\n> and a very long line\n> that ends\n\n')
})

test('a quote that cannot be found in the file is headed by the file alone', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'something else' })
  await md($, 'a.md')
  r.selection = { text: 'not there' }

  await quote($)
  expect(r.filled[0]?.text).toBe('a.md\n> not there\n\n')
})

test('quoting without a selection tells the person and fills nothing', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  await md($, 'a.md')

  await quote($)
  expect(r.filled).toEqual([])
  expect(r.toasts).toEqual(['Select a passage in the pane with the mouse first'])
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

test('the pane is headed by the file and its line count', async ($, on) => {
  engine(on, { '/proj/docs/a.md': 'one\ntwo\nthree\n' })
  await md($, 'docs/a.md')

  expect((await pane($)).header).toBe('docs/a.md · 3 lines')
})

test('the source view shows the Markdown as written, numbered by line, and toggles back', async ($, on) => {
  engine(on, { '/proj/a.md': '# A\n\n**b**\n' })
  await md($, 'a.md')
  expect(await button($, 'source')).toBe('Source')

  await press($, 'source')
  const { code, markdown, header } = await pane($)
  expect(code).toMatchObject({ source: '# A\n\n**b**\n', language: 'markdown', startLine: 1 })
  expect(markdown).toBeUndefined()
  expect(header).toContain('source')
  expect(await button($, 'source')).toBe('Rendered')

  await press($, 'source')
  expect((await pane($)).markdown?.text).toBe('# A\n\n**b**\n')
})

test('changes since the last prompt show as a diff, and the next prompt starts over', async ($, on) => {
  const files: Files = { '/proj/a.md': 'one\ntwo\nthree\n' }
  const r = engine(on, files)
  await start($)
  await md($, 'a.md')
  expect(await button($, 'changes')).toBeUndefined()

  files['/proj/a.md'] = 'one\n2\nthree\nfour\n'
  r.mtimes['/proj/a.md'] = 1
  await r.clock.advance(1000)
  expect(await button($, 'changes')).toBe('Changes +2 −1')

  await press($, 'changes')
  const { code, header } = await pane($)
  expect(code?.format).toBe('diff')
  expect(code?.source).toBe('@@ -1,3 +1,4 @@\n one\n-two\n+2\n three\n+four\n')
  expect(header).toContain('changes')
  expect(await button($, 'changes')).toBe('Hide changes')

  // A slash command is no new message; a prompt is, and the file as it stands becomes the base.
  await submit($, '/md', 'md')
  expect(await button($, 'changes')).toBe('Hide changes')
  await submit($, 'thanks')
  expect(await button($, 'changes')).toBeUndefined()
  expect((await pane($)).markdown?.text).toBe('one\n2\nthree\nfour\n')
})

test('the diff keeps far apart changes in hunks of their own', async ($, on) => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
  const after = before.map(line => (line === 'line 2' ? 'LINE 2' : line === 'line 18' ? 'LINE 18' : line))
  const files: Files = { '/proj/a.md': before.join('\n') }
  const r = engine(on, files)
  await start($)
  await md($, 'a.md')

  files['/proj/a.md'] = after.join('\n')
  r.mtimes['/proj/a.md'] = 1
  await r.clock.advance(1000)
  await press($, 'changes')
  const hunks = String((await pane($)).code?.source).match(/^@@ .* @@$/gm)
  expect(hunks).toEqual(['@@ -1,5 +1,5 @@', '@@ -15,6 +15,6 @@'])
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

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'doc', link: { href: 'file:///proj/docs/setup.md' } })
  await ui.unmount()
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
  expect((await pane($)).markdown?.pressableLinks).toEqual(['file:///proj/gone%20file.md'])

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'doc', link: { href: 'file:///proj/gone%20file.md' } })
  await ui.unmount()
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

test('a quote taken from the numbered source view drops the numbers and keeps the lines', async ($, on) => {
  const source = '# Plan\n\nThe **first** step.\n\n- see [docs](docs/a.md)\n'
  const r = engine(on, { '/proj/a.md': source })
  await md($, 'a.md')
  await press($, 'source')
  r.selection = { text: '  3 │ The **first** step.\n  4 │\n  5 │ - see [docs](docs/a.md)' }

  await quote($)
  expect(r.filled[0]?.text).toBe('a.md:3-5\n> The **first** step.\n>\n> - see [docs](docs/a.md)\n\n')
})

test('a number that starts a line of the rendered view stays in the quote', async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a\nb\n3 things\n' })
  await md($, 'a.md')
  r.selection = { text: '3 things' }

  await quote($)
  expect(r.filled[0]?.text).toBe('a.md:3\n> 3 things\n\n')
})

test('numbers that do not match the file stay in the quote', async ($, on) => {
  const r = engine(on, { '/proj/a.md': '# Steps\n\n1. one\n2. two\n' })
  await md($, 'a.md')
  r.selection = { text: '1. one\n2. two' }

  await quote($)
  expect(r.filled[0]?.text).toBe('a.md:3-4\n> 1. one\n> 2. two\n\n')
})

test('closing the pane clears the band', async ($, on) => {
  engine(on, { '/proj/a.md': 'a' })
  await md($, 'a.md')
  await closePane($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'quote' })).toBeUndefined()
  await ui.unmount()
})

test('a reply naming a .md offers it in the band, and the offer opens or goes away', async ($, on) => {
  const messages: Message[] = [user('write a plan'), assistant('Wrote docs/plan.md, please review.')]
  const r = engine(on, { '/proj/docs/plan.md': 'plan' }, messages)
  await turnEnds($)

  let ui = await $.ui.mount(BAND)
  expect((await ui.find({ key: 'offer' }))?.text).toBe('Open docs/plan.md')
  await ui.press({ key: 'offer' })
  expect(r.opened).toEqual(['plan.md'])
  await ui.unmount()

  // Opened, so the offer is gone; a later reply naming a file that does not exist offers nothing.
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'offer' })).toBeUndefined()
  await ui.unmount()
  messages.push(user('and another'), assistant('Also see notes.md'))
  await closePane($)
  await turnEnds($)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'offer' })).toBeUndefined()
  await ui.unmount()
})

test('the offer can be dismissed', async ($, on) => {
  engine(on, { '/proj/a.md': 'a' }, [user('go'), assistant('done: a.md')])
  await turnEnds($)

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ key: 'offer' })).toBeUndefined()
  await ui.unmount()
})

test('a reply naming no .md since the last prompt offers nothing', async ($, on) => {
  engine(on, { '/proj/a.md': 'a' }, [assistant('see a.md'), user('thanks'), assistant('ok')])
  await turnEnds($)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'offer' })).toBeUndefined()
  await ui.unmount()
})

test('/md arguments complete to Markdown files, the conversation first', async ($, on) => {
  const r = engine(on, { '/proj/docs/ai-agents.md': 'x' }, [assistant('see docs/ai-agents.md')])
  tracked(r, 'README.md', 'docs/ai-agents.md', 'docs/setup.md')

  const result = await autocomplete($, { text: '/md ag', cursor: 6, token: 'ag', start: 4 })
  expect(result.suggestions.map(s => s.text)).toEqual(['docs/ai-agents.md'])

  const all = await autocomplete($, { text: '/md d', cursor: 5, token: 'd', start: 4 })
  expect(all.suggestions.map(s => s.text)).toEqual(['docs/ai-agents.md', 'README.md', 'docs/setup.md'])

  // A match in the file name ranks above a loose one across the path.
  const named = await autocomplete($, { text: '/md setup', cursor: 9, token: 'setup', start: 4 })
  expect(named.suggestions.map(s => s.text)[0]).toBe('docs/setup.md')
})

test('autocomplete leaves other prompts alone', async ($, on) => {
  const r = engine(on, {})
  tracked(r, 'README.md')

  const result = await autocomplete($, { text: 'read REA', cursor: 8, token: 'REA', start: 5 })
  expect(result.suggestions).toEqual([])
})

test('the language option set to ja speaks Japanese', { options: { language: 'ja' } }, async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.config = [{ key: 'language', value: 'english' }]

  expect((await md($, 'a.md')).text).toBe('a.md をパネルで開きました')
  expect((await md($, 'zzz')).text).toContain('見つかりません: zzz')
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ key: 'quote' }))?.text).toBe('選択を引用')
  await ui.unmount()
})

test("auto follows Claude Code's language setting", async ($, on) => {
  const r = engine(on, { '/proj/a.md': 'a' })
  r.config = [{ key: 'language', value: 'Japanese' }]

  expect((await md($, 'a.md')).text).toBe('a.md をパネルで開きました')
})

test('auto falls back to the locale, then English', async ($, on) => {
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

test('opening a file keeps the offer of another', async ($, on) => {
  engine(on, { '/proj/a.md': 'a', '/proj/b.md': 'b' }, [user('go'), assistant('see b.md')])
  await turnEnds($)

  await md($, 'a.md')
  expect(await button($, 'offer')).toBe('Open b.md')
})

test('completion lists the project files once for a few seconds, while /md lists them afresh', async ($, on) => {
  const r = engine(on, { '/proj/docs/setup.md': 's' })
  tracked(r, 'docs/setup.md')
  const listed = () => r.ran.filter(argv => argv[0] === 'git').length

  await autocomplete($, { text: '/md s', cursor: 5, token: 's', start: 4 })
  await autocomplete($, { text: '/md se', cursor: 6, token: 'se', start: 4 })
  expect(listed()).toBe(1)

  await r.clock.advance(5000)
  await autocomplete($, { text: '/md set', cursor: 7, token: 'set', start: 4 })
  expect(listed()).toBe(2)

  await md($, 'setup')
  expect(listed()).toBe(3)
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

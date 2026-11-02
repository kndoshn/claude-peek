// What the engine answers beneath the plugin in the tests, and the steps the tests take.

import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On, PaneOpenArgs, PromptAutocompleteInput, PromptAutocompleteResult } from 'claude-code'

export const CWD = '/proj'
const HOME = '/home/me'
const PLUGIN = 'peek'

export type Files = Record<string, string>
export type Message = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool_use_id: string; tool: string; input: Record<string, unknown> }[]
  toolResults?: { tool_use_id: string; text: string; isError: boolean }[]
}
export type Run = { exitCode: number; stdout: string; stderr?: string }

export function assistant(text: string, toolUses: Message['toolUses'] = []): Message {
  return { role: 'assistant', text, toolUses }
}
export function user(text: string): Message {
  return { role: 'user', text, toolUses: [] }
}
export function toolResult(): Message {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't', text: 'ok', isError: false }] }
}

// The engine beneath the plugin. `files`, `messages` and the record's fields may change during a
// test; a file's modification time is 0 until `mtimes` says otherwise, a folder lists the files
// and folders under it, and a path in `links` is a symbolic link to the path it gives.
export function engine(on: On, files: Files, messages: Message[] = []) {
  const record = {
    clock: mock.clock(on),
    registered: [] as string[],
    opened: [] as string[],
    opens: [] as PaneOpenArgs[],
    closed: [] as string[],
    filled: [] as { text: string; mode?: string }[],
    toasts: [] as string[],
    copied: [] as string[],
    scrolls: [] as unknown[],
    selection: undefined as { text: string; requestId?: string } | undefined,
    // The session's working directory, which a worktree may move.
    cwd: CWD,
    // Whether the surface shows the pane, rather than another tab in front of it.
    isShown: true,
    // How often the conversation was read.
    messageReads: 0,
    draft: '',
    mtimes: {} as Record<string, number>,
    links: {} as Record<string, string>,
    env: {} as Record<string, string>,
    config: [] as { key: string; value: string }[],
    // The project's files as git and fd list them; fd is missing until a test sets it.
    git: { exitCode: 0, stdout: '' } as Run,
    fd: { exitCode: 127, stdout: '' } as Run,
    // Any other command: answered by this, else as missing.
    commands: {} as Record<string, Run | ((argv: readonly string[]) => Run | Promise<Run>)>,
    ran: [] as { argv: string[]; cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number }[],
  }
  mock.store(on)
  on('command.register', (_, e) => {
    record.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    record.opened.push(e.title ?? e.id)
    record.opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    record.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value:
      record.opened.length > record.closed.length
        ? [{ id: PLUGIN, title: '', isShown: record.isShown, isFocused: false, isPlaced: true }]
        : [],
  }))
  on('ui.scroll', (_, e) => {
    record.scrolls.push(e.requestId)
    return {}
  })
  on('ui.copy', (_, e) => {
    record.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('session.cwd', () => ({ value: record.cwd }))
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
  const isDir = (path: string) => Object.keys(files).some(file => file.startsWith(`${path}/`))
  // Where a path leads, the links on the way followed.
  const resolve = (path: string) => {
    for (const [link, target] of Object.entries(record.links)) {
      if (path === link || path.startsWith(`${link}/`)) return `${target}${path.slice(link.length)}`
    }
    return path
  }
  on('fs.exists', (_, e) => ({ value: resolve(e.path) in files || isDir(resolve(e.path)) }))
  on('fs.read', (_, e) => {
    const text = files[resolve(e.path)]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.stat', (_, e) => {
    const path = resolve(e.path)
    const text = files[path]
    if (text === undefined && !isDir(path)) throw new Error(`ENOENT: ${e.path}`)
    const kind = text === undefined ? ('dir' as const) : ('file' as const)
    return { value: { kind, size: text?.length ?? 0, mtimeMs: record.mtimes[path] ?? 0, isLink: e.path in record.links } }
  })
  on('fs.list', (_, e) => {
    const asked = e.path ?? CWD
    const dir = resolve(asked)
    if (!isDir(dir)) throw new Error(`ENOENT: ${asked}`)
    const names = new Map<string, FsEntry>()
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith(`${dir}/`)) continue
      const [name, ...rest] = path.slice(dir.length + 1).split('/')
      if (!name) continue
      names.set(name, rest.length
        ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
        : { name, kind: 'file', size: text.length, mtimeMs: 0, isLink: false })
    }
    // A link is listed as itself, not as what it leads to.
    for (const link of Object.keys(record.links)) {
      const name = link.slice(asked.length + 1)
      if (link.startsWith(`${asked}/`) && !name.includes('/')) names.set(name, { name, kind: 'other', size: 0, mtimeMs: 0, isLink: true })
    }
    return { value: [...names.values()] }
  })
  on('session.messages', () => {
    record.messageReads += 1
    return { value: messages }
  })
  on('ui.selection', () => ({ value: record.selection }))
  on('prompt.read', () => ({ value: { text: record.draft, cursor: record.draft.length } }))
  on('prompt.fill', (_, e) => {
    record.filled.push({ text: e.text, mode: e.mode })
    record.draft = e.mode === 'append' ? `${record.draft}${e.text}` : e.text
    return { isFilled: true }
  })
  on('ui.toast', (_, e) => {
    record.toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', async (_, e) => {
    record.ran.push({ argv: [...e.argv], cwd: e.init?.cwd, env: e.init?.env, stdin: e.init?.stdin, timeoutMs: e.init?.timeoutMs })
    const custom = record.commands[e.argv.join(' ')] ?? record.commands[e.argv[0] ?? '']
    const run =
      e.argv[0] === 'git' && e.argv[1] === 'ls-files' && !e.argv.includes('--ignored') && !custom
        ? record.git
        : e.argv[0] === 'fd'
          ? record.fd
          : typeof custom === 'function'
            ? await custom(e.argv)
            : (custom ?? { exitCode: 127, stdout: '' })
    return { value: { stderr: '', ...run, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.autocomplete', () => ({ suggestions: [] }))
  // The engine's own drawing, where the plugin draws nothing.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  return record
}

export type Recorded = ReturnType<typeof engine>

// The project's files as `git ls-files -z` prints them.
export function tracked(record: Recorded, ...paths: string[]) {
  record.git = { exitCode: 0, stdout: paths.map(path => `${path}\0`).join('') }
}

export const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: PLUGIN,
  surface: 'terminal',
  props: {
    title: 'peek',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

export const BAND = {
  plugin: PLUGIN,
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

export async function command($: Engine, name: string, args: string) {
  return $.command.run({
    command: name,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
}

export async function md($: Engine, args = '') {
  return command($, 'md', args)
}

export async function peek($: Engine, args = '') {
  return command($, 'peek', args)
}

// prompt.autocomplete is raised by the engine alone, so the test engine's typing leaves it out;
// it still runs the chain.
export async function autocomplete($: Engine, text: string): Promise<PromptAutocompleteResult> {
  const start = text.lastIndexOf(' ') + 1
  const e: PromptAutocompleteInput = { text, cursor: text.length, token: text.slice(start), start }
  const prompt = $.prompt as unknown as {
    autocomplete: (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult>
  }
  return prompt.autocomplete(e)
}

export async function turnEnds($: Engine) {
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' })
}

export async function start($: Engine) {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
}

// The conversation ends: a /clear, a resume of another, or the person leaving.
export async function sessionEnds($: Engine, reason: 'clear' | 'resume' | 'prompt_input_exit') {
  await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
}

export async function submit($: Engine, text: string, commandName?: string) {
  await $.prompt.submit({
    text,
    wait: false,
    origin: { kind: 'composer' },
    ...(commandName ? { command: { name: commandName, args: '' } } : {}),
  })
}

// Presses a button of the band.
export async function press($: Engine, key: string) {
  const ui = await $.ui.mount(BAND)
  await ui.press({ key })
  await ui.unmount()
}

// Presses an element the pane drew, a link of a Markdown with `href`.
export async function pressPane($: Engine, key: string, href?: string) {
  const ui = await $.ui.mount(PANE)
  await ui.press(href ? { key, link: { href } } : { key })
  await ui.unmount()
}

// The label of a button of the band, or undefined while it is not drawn.
export async function button($: Engine, key: string): Promise<string | undefined> {
  const ui = await $.ui.mount(BAND)
  const found = await ui.find({ key })
  await ui.unmount()
  return found?.text
}

// What the pane draws: its header and how a header too wide for the pane is cut, every
// Markdown's and Code's props, and the text of any key.
export async function pane($: Engine, key?: string) {
  const ui = await $.ui.mount(PANE)
  const markdown = (await ui.find({ type: 'Markdown' }))?.props
  const codes = (await ui.findAll({ type: 'Code' })).map(found => found.props)
  const found = await ui.find({ key: 'header' })
  const header = found?.text
  const [heading] = (found?.children ?? []) as Array<{ props?: { wrap?: unknown } } | string>
  const headingWrap = typeof heading === 'object' ? heading.props?.wrap : undefined
  const keyed = key ? await ui.find({ key }) : undefined
  await ui.unmount()
  return { markdown, code: codes[0], codes, header, headingWrap, keyed }
}

// The Markdown text the pane draws.
export async function shown($: Engine): Promise<string | undefined> {
  const text = (await pane($)).markdown?.text
  return typeof text === 'string' ? text : undefined
}

import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { candidates, recentMessages, existing, resetFind, resolvePlace, where } from './find'
import type { Kind } from './find'
import { configureLanguage, messages } from './messages'
import type { Messages } from './messages'
import { forgetPane, isPaneShown, navigate, openView, PANE, reopen } from './nav'
import { rank, suggestion } from './pure/paths'
import { parseTarget } from './pure/target'
import { drawBand } from './ui/band'
import { drawPane } from './ui/pane'
import { configureCommand, recentCommands, runCommand } from './views/command'
import type { Opened } from './nav'
import { offerNamed, rebaseFile, refreshFile, resetFile } from './views/file'
import { markGitStale, resetGit, tickGit } from './views/git'
import { markTreeStale, resetTree, tickTree } from './views/tree'

// peek: look at a file, a folder, Git or a command's output in a pane beside the chat, and quote
// what is needed into the prompt with where it came from, so nothing is copied from another tab.
// See docs/design.md.
//
// This file wires the events: nav.ts keeps the pane and Back, views/ each view's state and
// steps, ui/ draws, find.ts finds files, prompt.ts writes into the prompt, and pure/ is pure.

type Api = EngineInterface

// How often the shown file is checked for changes on disk.
const WATCH_MS = 1000
const MAX_SUGGESTIONS = 10

// The tools whose calls may change files.
const CHANGING_TOOLS = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

// Every tick: the file open is checked for changes on disk; the tree or Git is read again when
// due, only while the pane is in sight, as nobody sees it otherwise.
async function watch($: Api): Promise<void> {
  const view = await openView($)
  if (view === 'file') await refreshFile($)
  if (view !== 'tree' && view !== 'git') return
  if (!(await isPaneShown($))) return
  if (view === 'tree') await tickTree($, await messages($))
  else await tickGit($, await messages($))
}

// What a command says when it opened something, or why not.
function report(say: Messages, opened: Opened): { text: string } {
  return { text: 'error' in opened ? opened.error : say.opened(opened.label) }
}

// /peek: reopens the last place without a target (the working directory the first time), else
// opens what the target names: a command's output, Git, a file at its lines, or a folder.
async function peekCommand($: Api, args: string): Promise<{ text: string }> {
  const say = await messages($)
  const at = await where($)
  const target = parseTarget(args)
  if (target.kind === 'empty') {
    const reopened = await reopen($, say)
    return report(say, reopened ?? (await navigate($, say, { view: 'tree', root: at.cwd }, 'anew')))
  }
  if (target.kind === 'command') {
    await runCommand($, target.command)
    return report(say, await navigate($, say, { view: 'command' }, 'anew'))
  }
  if (target.kind === 'git') return report(say, await navigate($, say, { view: 'git' }, 'anew'))
  const place = await resolvePlace($, at, target.path, 'place')
  if (!place) return { text: say.notFound(args.trim()) }
  if (place.isDir) return report(say, await navigate($, say, { view: 'tree', root: place.path }, 'anew'))
  return report(say, await navigate($, say, { view: 'file', path: place.path, ...(target.lines ? { lines: target.lines } : {}) }, 'anew'))
}

// /tree (with the setting on): the folder named, or without one the working directory.
async function treeCommand($: Api, args: string): Promise<{ text: string }> {
  const say = await messages($)
  const at = await where($)
  const text = args.trim()
  const place = text ? await resolvePlace($, at, text, 'place') : { path: at.cwd, isDir: true }
  if (!place) return { text: say.notFound(text) }
  if (!place.isDir) return { text: say.notFolder(place.path) }
  return report(say, await navigate($, say, { view: 'tree', root: place.path }, 'anew'))
}

// /md: the Markdown named, or without one the newest .md the conversation named.
async function mdCommand($: Api, args: string): Promise<{ text: string }> {
  const say = await messages($)
  const at = await where($)
  const target = parseTarget(args)
  const text = target.kind === 'path' ? target.path : args.trim()
  const path = text
    ? (await resolvePlace($, at, text, 'markdown'))?.path
    : (await existing($, at, await recentMessages($), 'markdown'))[0]
  if (!path) return { text: text ? say.notFound(text) : say.noneRecentMarkdown }
  const lines = target.kind === 'path' ? target.lines : undefined
  return report(say, await navigate($, say, { view: 'file', path, ...(lines ? { lines } : {}) }, 'anew', 'markdown'))
}

export const register: Register = (on, options: PluginOptions) => {
  // /tree and /git take names other plugins and skills may want, so they come only when asked.
  const hasShortCommands = options.shortCommands === true
  // A load starts over: what an earlier load worked out may not hold for this one.
  configureLanguage(options.language)
  configureCommand(options.commandTimeoutSeconds)
  resetFind()
  resetFile()
  resetTree()
  resetGit()

  on('session.start', async ($, e, next) => {
    const say = await messages($)
    await $.command.register({ name: 'peek', description: say.peekCommand, argumentHint: say.peekArgument, immediate: true })
    await $.command.register({ name: 'md', description: say.mdCommand, argumentHint: say.mdArgument, immediate: true })
    if (hasShortCommands) {
      await $.command.register({ name: 'tree', description: say.treeCommand, argumentHint: say.treeArgument, immediate: true })
      await $.command.register({ name: 'git', description: say.gitCommand, immediate: true })
    }
    $.clock.every(WATCH_MS, () => {
      watch($).catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'peek' }, async ($, e) => peekCommand($, e.args))
  on('command.run', { command: 'md' }, async ($, e) => mdCommand($, e.args))
  // Without the setting, /tree and /git are another plugin's or skill's, if anyone's.
  on('command.run', { command: 'tree' }, async ($, e, next) => (hasShortCommands ? treeCommand($, e.args) : next(e)))
  on('command.run', { command: 'git' }, async ($, e, next) => {
    if (!hasShortCommands) return next(e)
    const say = await messages($)
    return report(say, await navigate($, say, { view: 'git' }, 'anew'))
  })

  // Complete the argument of /peek (any file) and /md (Markdown): the files the conversation
  // named, then the project's.
  on('prompt.autocomplete', async ($, e, next) => {
    const base = await next(e)
    const command = /^\/(peek|md)\s/.exec(e.text)?.[1]
    if (!command || e.start <= command.length + 1) return base
    try {
      // The commands run before, while `!` and the command's first word are being typed.
      if (command === 'peek' && e.token.startsWith('!') && e.text.slice(0, e.start).trim() === '/peek') {
        const typed = e.token.slice(1)
        const mine = (await recentCommands($))
          .filter(run => run.startsWith(typed))
          .slice(0, MAX_SUGGESTIONS)
          .map(run => ({ text: `!${run}` }))
        return { suggestions: [...base.suggestions, ...mine] }
      }
      const kind: Kind = command === 'md' ? 'markdown' : 'place'
      const say = await messages($)
      const keyword = command === 'peek' && e.token !== '' && 'git'.startsWith(e.token) ? [{ text: 'git', label: 'git', description: say.views.git }] : []
      const mine = [
        ...keyword,
        ...rank(e.token, await candidates($, await where($), kind, false))
          .slice(0, MAX_SUGGESTIONS - keyword.length)
          .map(suggestion),
      ]

      return { suggestions: [...base.suggestions, ...mine] }
    } catch {
      return base
    }
  })

  // The person's message (not a slash command) starts the count of changes again.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta) await rebaseFile($).catch(() => undefined)

    return next(e)
  }).catch((_, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    markTreeStale()
    markGitStale()
    await offerNamed($).catch(() => undefined)

    return result
  })

  // A command or an edit of Claude's may change what the tree shows.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (CHANGING_TOOLS.has(e.tool)) {
      markTreeStale()
      markGitStale()
    }

    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await forgetPane($).catch(() => undefined)

    return next(e)
  }).catch((_, e, next) => next(e))

  // A literal, so the engine's scan of the module reads which pane this draws.
  on('ui.render', { component: 'Pane', requestId: 'peek' satisfies typeof PANE }, async ($, e) => drawPane($, e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => (await drawBand($, e)) ?? next(e))
}

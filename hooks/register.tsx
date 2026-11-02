import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { candidates, existing, recentMessages, resetFind, resolveFile, where } from './find'
import type { Kind } from './find'
import { configureLanguage, messages } from './messages'
import type { Messages } from './messages'
import { forgetPane, isShowing, navigate, PANE, reopen } from './nav'
import { rank, suggestion } from './pure/paths'
import { parseTarget } from './pure/target'
import { drawBand } from './ui/band'
import { drawPane } from './ui/pane'
import { offerNamed, rebaseFile, refreshFile, resetFile } from './views/file'
import type { Opened } from './views/file'

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

// What a command says when it opened something, or why not.
function report(say: Messages, opened: Opened): { text: string } {
  return { text: 'error' in opened ? opened.error : say.opened(opened.label) }
}

// /peek: reopens the last place without a target, else opens what the target names.
async function peekCommand($: Api, args: string): Promise<{ text: string }> {
  const say = await messages($)
  const at = await where($)
  const target = parseTarget(args)
  if (target.kind === 'empty') {
    const reopened = await reopen($, say)
    if (reopened) return report(say, reopened)
    const [path] = await existing($, at, await recentMessages($), 'any')
    if (!path) return { text: say.noneRecent }
    return report(say, await navigate($, say, { view: 'file', path }, 'anew'))
  }
  if (target.kind !== 'path') return { text: say.notFound(args.trim()) }
  const path = await resolveFile($, at, target.path, 'any')
  if (!path) return { text: say.notFound(args.trim()) }
  return report(say, await navigate($, say, { view: 'file', path, ...(target.lines ? { lines: target.lines } : {}) }, 'anew'))
}

// /md: the Markdown named, or without one the newest .md the conversation named.
async function mdCommand($: Api, args: string): Promise<{ text: string }> {
  const say = await messages($)
  const at = await where($)
  const target = parseTarget(args)
  const text = target.kind === 'path' ? target.path : args.trim()
  const path = text
    ? await resolveFile($, at, text, 'markdown')
    : (await existing($, at, await recentMessages($), 'markdown'))[0]
  if (!path) return { text: text ? say.notFound(text) : say.noneRecentMarkdown }
  const lines = target.kind === 'path' ? target.lines : undefined
  return report(say, await navigate($, say, { view: 'file', path, ...(lines ? { lines } : {}) }, 'anew', 'markdown'))
}

export const register: Register = (on, options: PluginOptions) => {
  // A load starts over: what an earlier load worked out may not hold for this one.
  configureLanguage(options.language)
  resetFind()
  resetFile()

  on('session.start', async ($, e, next) => {
    const say = await messages($)
    await $.command.register({ name: 'peek', description: say.peekCommand, argumentHint: say.peekArgument, immediate: true })
    await $.command.register({ name: 'md', description: say.mdCommand, argumentHint: say.mdArgument, immediate: true })
    $.clock.every(WATCH_MS, () => {
      isShowing($, 'file')
        .then(showing => (showing ? refreshFile($) : undefined))
        .catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'peek' }, async ($, e) => peekCommand($, e.args))
  on('command.run', { command: 'md' }, async ($, e) => mdCommand($, e.args))

  // Complete the argument of /peek (any file) and /md (Markdown): the files the conversation
  // named, then the project's.
  on('prompt.autocomplete', async ($, e, next) => {
    const base = await next(e)
    const command = /^\/(peek|md)\s/.exec(e.text)?.[1]
    if (!command || e.start <= command.length + 1) return base
    try {
      const kind: Kind = command === 'md' ? 'markdown' : 'any'
      const mine = rank(e.token, await candidates($, await where($), kind, false))
        .slice(0, MAX_SUGGESTIONS)
        .map(suggestion)

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
    await offerNamed($).catch(() => undefined)

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

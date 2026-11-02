import type { PluginOptions, Register } from 'claude-code'

import { forget, offerNamed, openAnew, PANE, rebase, refresh, resetDoc } from './doc'
import { candidates, existing, recentMessages, resetFiles, resolveArg, where } from './files'
import { configureLanguage, messages } from './messages'
import { rank, suggestion } from './paths'
import { drawBand, drawPane } from './ui'

// md-review: read a Markdown file rendered in a pane beside the chat and quote passages of it
// into the prompt, so a review needs no other tab, editor or browser.
//   /md [path]   opens the file: a path, part of a file name, or without one the newest .md
//                the conversation named; its argument completes to the conversation's and
//                the project's Markdown files
//   the pane     the file rendered, as written with line numbers, or the changes since the
//                person's last message; it follows the file on disk, and a relative link to
//                another Markdown file opens that file in it
//   the band     above the prompt: quote the mouse selection headed by its file and lines,
//                switch the view, go back, close, and an offer to open the .md the last
//                reply named
//
// This file wires the events; doc.ts holds the state and its steps, files.ts finds files,
// ui.tsx draws, and paths.ts, quote.ts, markdown.ts and diff.ts are pure.

// How often the shown file is checked for changes on disk.
const WATCH_MS = 1000
const MAX_SUGGESTIONS = 10

export const register: Register = (on, options: PluginOptions) => {
  // A load starts over: what an earlier load worked out may not hold for this one.
  configureLanguage(options.language)
  resetFiles()
  resetDoc()

  on('session.start', async ($, e, next) => {
    const say = await messages($)
    await $.command.register({ name: 'md', description: say.command, argumentHint: say.argument, immediate: true })
    $.clock.every(WATCH_MS, () => {
      refresh($).catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'md' }, async ($, e) => {
    const say = await messages($)
    const at = await where($)
    const arg = e.args.trim()
    const path = arg ? await resolveArg($, at, arg) : (await existing($, at, await recentMessages($)))[0]
    if (!path) return { text: arg ? say.notFound(arg) : say.noneRecent }
    const opened = await openAnew($, say, path)

    return { text: 'error' in opened ? opened.error : say.opened(opened.label) }
  })

  // Complete the argument of /md: the .md files the conversation named, then the project's.
  on('prompt.autocomplete', async ($, e, next) => {
    const base = await next(e)
    if (!/^\/md\s/.test(e.text) || e.start < 4) return base
    try {
      const mine = rank(e.token, await candidates($, await where($), false))
        .slice(0, MAX_SUGGESTIONS)
        .map(suggestion)

      return { suggestions: [...base.suggestions, ...mine] }
    } catch {
      return base
    }
  })

  // The person's message (not a slash command) starts the count of changes again.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta) await rebase($).catch(() => undefined)

    return next(e)
  }).catch((_, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await offerNamed($).catch(() => undefined)

    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await forget($).catch(() => undefined)

    return next(e)
  }).catch((_, e, next) => next(e))

  // A literal, so the engine's scan of the module reads which pane this draws.
  on('ui.render', { component: 'Pane', requestId: 'md-review' satisfies typeof PANE }, async ($, e) => drawPane($, e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => (await drawBand($, e)) ?? next(e))
}

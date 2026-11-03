// Handing what the person picked to Claude: appending it to the draft in the prompt box.

import type { EngineInterface } from 'claude-code'

import type { ViewName } from '../types'
import type { Messages } from './messages'
import { navState } from './nav'
import { quote } from './pure/quote'
import type { Quoted } from './pure/quote'
import { fileMention, fileQuote } from './views/file'
import { gitMention, gitQuote } from './views/git'
import { treeBlock, treeMention, treeQuote } from './views/tree'

type Api = EngineInterface

// Appends a block (a quote) after the draft, a blank line apart, with a blank line after it.
async function appendBlock($: Api, block: string): Promise<void> {
  const draft = (await $.prompt.read()).text
  const gap = draft === '' || draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n'
  await $.prompt.fill({ text: `${gap}${block}\n\n`, mode: 'append' })
}

// Appends a word (an @ mention) after the draft, a space apart, with a space after it.
async function appendWord($: Api, word: string): Promise<void> {
  const draft = (await $.prompt.read()).text
  const gap = draft === '' || /\s$/.test(draft) ? '' : ' '
  await $.prompt.fill({ text: `${gap}${word} `, mode: 'append' })
}

// Where `selected` came from in `view`, as a heading and the text to quote; undefined when it is
// not in the view.
async function quoteFrom($: Api, say: Messages, view: ViewName, selected: string): Promise<Quoted | undefined> {
  switch (view) {
    case 'file':
      return fileQuote($, selected)
    case 'tree':
      return treeQuote($, say, selected)
    case 'git':
      return gitQuote($, selected)
  }
}

// Quotes the person's selection, headed by where it came from in the view shown. A selection the
// engine places in the conversation (it carries a row's requestId) gets no heading; one without
// could still span several rows of the conversation, so the view's text decides.
export async function quoteSelection($: Api, say: Messages): Promise<void> {
  const selected = await $.ui.selection()
  if (!selected || selected.text.trim() === '') {
    $.ui.toast(say.selectFirst)
    return
  }
  const view = (await navState($)).view
  const from = selected.requestId === undefined && view !== null ? await quoteFrom($, say, view, selected.text) : undefined
  const text = from?.text ?? selected.text
  await appendBlock($, from?.head ? `${from.head}\n${quote(text)}` : quote(text))
}

// Mentions what the view points at: the file or folder with an @, so Claude reads it; the commit
// opened by its hash and subject.
export async function mention($: Api): Promise<void> {
  const state = await navState($)
  const label = state.view === 'file' ? await fileMention($) : state.view === 'tree' ? await treeMention($) : undefined
  if (label) await appendWord($, `@${label}`)
  const commit = state.view === 'git' ? await gitMention($) : undefined
  if (commit) await appendWord($, commit)
}

// Quotes the tree shown, under its folder.
export async function quoteTree($: Api, say: Messages): Promise<void> {
  if ((await navState($)).view !== 'tree') return
  const block = await treeBlock($, say)
  if (block) await appendBlock($, block)
}

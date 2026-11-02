// Handing what the person picked to Claude: appending it to the draft in the prompt box.

import type { EngineInterface } from 'claude-code'

import type { Messages } from './messages'
import { navState } from './nav'
import { quote } from './pure/quote'
import { fileMention, fileQuote } from './views/file'

type Api = EngineInterface

// Appends a block (a quote) after the draft, a blank line apart, with a blank line after it.
export async function appendBlock($: Api, block: string): Promise<void> {
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

// Quotes the person's selection, headed by where it came from in the view shown. A selection the
// engine places in the conversation (it carries a row's requestId) gets no heading; one without
// could still span several rows of the conversation, so the view's text decides.
export async function quoteSelection($: Api, say: Messages): Promise<void> {
  const selected = await $.ui.selection()
  if (!selected || selected.text.trim() === '') {
    $.ui.toast(say.selectFirst)
    return
  }
  const state = await navState($)
  const from = selected.requestId === undefined && state.view === 'file' ? await fileQuote($, selected.text) : undefined
  const text = from?.text ?? selected.text
  await appendBlock($, from?.head ? `${from.head}\n${quote(text)}` : quote(text))
}

// Mentions the file or folder the view points at, so Claude reads it.
export async function mention($: Api): Promise<void> {
  const state = await navState($)
  const label = state.view === 'file' ? await fileMention($) : undefined
  if (label) await appendWord($, `@${label}`)
}

// The band above the prompt: the view's buttons while the pane is open, and the offer of the .md
// the last reply named.

import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { Messages } from '../messages'
import { messages } from '../messages'
import { closePane, goBack, navigate, navState } from '../nav'
import { mention, quoteSelection } from '../prompt'
import { count } from '../pure/diff'
import { changesOf, dismissOffer, offeredFile, shownFile, toggleFileMode } from '../views/file'

type Api = EngineInterface

// The buttons of the file view.
async function fileButtons($: Api, e: RenderInput<'AbovePrompt'>, say: Messages): Promise<RenderElement[]> {
  const { Button } = $.ui.resolve(e)
  const shown = await shownFile($)
  if (!shown) return []
  const { added, removed } = count(changesOf(shown))
  const buttons: RenderElement[] = []
  if (shown.isMarkdown) {
    buttons.push(
      <Button
        key="source"
        label={shown.mode === 'source' ? say.rendered : say.source}
        hotkey="s"
        onPress={() => toggleFileMode($, 'source')}
      />,
    )
  }
  if (shown.mode === 'changes' || added + removed > 0) {
    buttons.push(
      <Button
        key="changes"
        label={shown.mode === 'changes' ? say.hideChanges : say.changes(added, removed)}
        hotkey="d"
        onPress={() => toggleFileMode($, 'changes')}
      />,
    )
  }
  buttons.push(<Button key="mention" label={say.mention} hotkey="a" onPress={() => mention($)} />)
  return buttons
}

// The band, or undefined when there is nothing to show.
export async function drawBand($: Api, e: RenderInput<'AbovePrompt'>): Promise<RenderElement | undefined> {
  const state = await navState($)
  const offered = await offeredFile($)
  const isOpen = state.isOpen && state.view !== null
  if (e.props.hasSurvey || (!isOpen && !offered)) return undefined
  const { Box, Button } = $.ui.resolve(e)
  const say = await messages($)
  const buttons = isOpen && state.view === 'file' ? await fileButtons($, e, say) : []

  const openOffered = async () => {
    if (!offered) return
    const opened = await navigate($, say, { view: 'file', path: offered.path }, 'anew', 'markdown')
    if ('error' in opened) $.ui.toast(opened.error)
  }

  return (
    <Box gap={1} flexWrap="wrap">
      {isOpen && <Button key="quote" label={say.quote} hotkey="q" variant="primary" onPress={() => quoteSelection($, say)} />}
      {isOpen && buttons}
      {isOpen && state.back.length > 0 && <Button key="back" label={say.back} hotkey="b" onPress={() => goBack($, say)} />}
      {isOpen && <Button key="close" label={say.close} dimColor onPress={() => closePane($)} />}
      {offered && <Button key="offer" label={say.open(offered.label)} hotkey="o" onPress={openOffered} />}
      {offered && <Button key="dismiss" label={say.dismiss} dimColor onPress={() => dismissOffer($)} />}
    </Box>
  )
}

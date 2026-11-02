// The band above the prompt: the views to switch between, the shown view's buttons while the
// pane is open, and the offer of the .md the last reply named.

import type { EngineInterface, RenderElement, RenderInput, UiPressArgument } from 'claude-code'

import type { ViewName } from '../../types'
import type { Messages } from '../messages'
import { messages } from '../messages'
import { closePane, goBack, navigate, navState, switchView } from '../nav'
import { mention, quoteAll, quoteSelection } from '../prompt'
import { count } from '../pure/diff'
import { commandOutput, rerunCommand } from '../views/command'
import { changesOf, dismissOffer, offeredFile, shownFile, toggleFileMode } from '../views/file'

type Api = EngineInterface

// The views the band switches between, in its order.
const VIEWS: readonly ViewName[] = ['file', 'command']

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

// The buttons of the command view.
function commandButtons($: Api, e: RenderInput<'AbovePrompt'>, say: Messages): RenderElement[] {
  const { Button } = $.ui.resolve(e)
  const copy = async (press: UiPressArgument) => {
    const output = await commandOutput($)
    if (output === undefined) return
    const copied = await $.ui.copy({ text: output, surface: press.surface })
    if (copied.isCopied) $.ui.toast(say.copied)
  }
  return [
    <Button key="quote-all" label={say.quoteAll} hotkey="t" onPress={() => quoteAll($)} />,
    <Button key="rerun" label={say.rerun} hotkey="r" onPress={() => rerunCommand($)} />,
    <Button key="copy" label={say.copy} hotkey="c" onPress={copy} />,
  ]
}

// The band, or undefined when there is nothing to show.
export async function drawBand($: Api, e: RenderInput<'AbovePrompt'>): Promise<RenderElement | undefined> {
  const state = await navState($)
  const offered = await offeredFile($)
  const isOpen = state.isOpen && state.view !== null
  if (e.props.hasSurvey || (!isOpen && !offered)) return undefined
  const { Box, Button, Text } = $.ui.resolve(e)
  const say = await messages($)
  const buttons =
    !isOpen ? [] : state.view === 'file' ? await fileButtons($, e, say) : state.view === 'command' ? commandButtons($, e, say) : []

  const openOffered = async () => {
    if (!offered) return
    const opened = await navigate($, say, { view: 'file', path: offered.path }, 'anew', 'markdown')
    if ('error' in opened) $.ui.toast(opened.error)
  }

  return (
    <Box gap={1} flexWrap="wrap">
      {isOpen &&
        VIEWS.map(view => (
          <Button
            key={`view:${view}`}
            label={say.views[view]}
            plain
            {...(view === state.view ? {} : { dimColor: true })}
            onPress={() => switchView($, say, view)}
          />
        ))}
      {isOpen && <Text dimColor>│</Text>}
      {isOpen && <Button key="quote" label={say.quote} hotkey="q" variant="primary" onPress={() => quoteSelection($, say)} />}
      {isOpen && buttons}
      {isOpen && state.back.length > 0 && <Button key="back" label={say.back} hotkey="b" onPress={() => goBack($, say)} />}
      {isOpen && <Button key="close" label={say.close} dimColor onPress={() => closePane($)} />}
      {offered && <Button key="offer" label={say.open(offered.label)} hotkey="o" onPress={openOffered} />}
      {offered && <Button key="dismiss" label={say.dismiss} dimColor onPress={() => dismissOffer($)} />}
    </Box>
  )
}

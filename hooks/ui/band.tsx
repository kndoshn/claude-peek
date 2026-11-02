// The band above the prompt: the views to switch between, the shown view's buttons while the
// pane is open, and the offer of the .md the last reply named.

import type { EngineInterface, RenderElement, RenderInput, UiPressArgument } from 'claude-code'

import type { ViewName } from '../../types'
import type { Messages } from '../messages'
import { messages } from '../messages'
import { closePane, goBack, navigate, navState, refit, switchView } from '../nav'
import { mention, quoteAll, quoteSelection } from '../prompt'
import { count } from '../pure/diff'
import { commandOutput, rerunCommand } from '../views/command'
import { changesOf, dismissOffer, offeredFile, shownFile, toggleFileMode } from '../views/file'
import { refreshGit, shownGit } from '../views/git'
import { shownTreeText } from '../views/tree'

type Api = EngineInterface

// The views the band switches between, in its order.
const VIEWS: readonly ViewName[] = ['file', 'tree', 'git', 'command']

// Puts `text` on the clipboard of the surface pressed on, and says so.
async function copy($: Api, say: Messages, text: string | undefined, press: UiPressArgument): Promise<void> {
  if (text === undefined) return
  const copied = await $.ui.copy({ text, surface: press.surface })
  if (copied.isCopied) $.ui.toast(say.copied)
}

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

// The buttons of the tree view.
function treeButtons($: Api, e: RenderInput<'AbovePrompt'>, say: Messages): RenderElement[] {
  const { Button } = $.ui.resolve(e)
  return [
    <Button key="quote-tree" label={say.quoteTree} hotkey="t" onPress={() => quoteAll($, say)} />,
    <Button key="mention" label={say.mention} hotkey="a" onPress={() => mention($)} />,
    <Button key="copy" label={say.copy} hotkey="c" onPress={async press => copy($, say, await shownTreeText($, say), press)} />,
  ]
}

// The buttons of the Git view.
async function gitButtons($: Api, e: RenderInput<'AbovePrompt'>, say: Messages): Promise<RenderElement[]> {
  const { Button } = $.ui.resolve(e)
  const shown = await shownGit($)
  const buttons: RenderElement[] = []
  if (shown?.commit) buttons.push(<Button key="mention" label={say.commitToPrompt} hotkey="a" onPress={() => mention($)} />)
  buttons.push(<Button key="refresh" label={say.refresh} hotkey="r" onPress={() => refreshGit($, say)} />)
  return buttons
}

// Runs the command again, and fits the pane to its output once it ended.
async function rerun($: Api, say: Messages): Promise<void> {
  const run = await rerunCommand($)
  if (run && (await run.ended)) await refit($, say, 'command')
}

// The buttons of the command view.
function commandButtons($: Api, e: RenderInput<'AbovePrompt'>, say: Messages): RenderElement[] {
  const { Button } = $.ui.resolve(e)
  return [
    <Button key="quote-all" label={say.quoteAll} hotkey="t" onPress={() => quoteAll($, say)} />,
    <Button key="rerun" label={say.rerun} hotkey="r" onPress={() => rerun($, say)} />,
    <Button key="copy" label={say.copy} hotkey="c" onPress={async press => copy($, say, await commandOutput($), press)} />,
  ]
}

// The buttons of the view shown.
async function viewButtons($: Api, e: RenderInput<'AbovePrompt'>, say: Messages, view: ViewName): Promise<RenderElement[]> {
  switch (view) {
    case 'file':
      return fileButtons($, e, say)
    case 'tree':
      return treeButtons($, e, say)
    case 'git':
      return gitButtons($, e, say)
    case 'command':
      return commandButtons($, e, say)
  }
}

// The band, or undefined when there is nothing to show.
export async function drawBand($: Api, e: RenderInput<'AbovePrompt'>): Promise<RenderElement | undefined> {
  const state = await navState($)
  const offered = await offeredFile($)
  const view = state.isOpen ? state.view : null
  const isOpen = view !== null
  if (e.props.hasSurvey || (!isOpen && !offered)) return undefined
  const { Box, Button, Text } = $.ui.resolve(e)
  const say = await messages($)
  // While another tab is in front of the pane, what acts on the view shown is left out; the
  // views bring the pane back, and a selection there is quoted without a heading.
  const isBehind = state.isBehind === true
  const buttons = view === null || isBehind ? [] : await viewButtons($, e, say, view)

  const openOffered = async () => {
    if (!offered) return
    const opened = await navigate($, say, { view: 'file', path: offered.path }, 'anew', 'markdown')
    if ('error' in opened) $.ui.toast(opened.error)
  }

  return (
    <Box gap={1} flexWrap="wrap">
      {isOpen &&
        VIEWS.map(name => (
          <Button
            key={`view:${name}`}
            label={say.views[name]}
            plain
            {...(name === view ? {} : { dimColor: true })}
            onPress={() => switchView($, say, name)}
          />
        ))}
      {isOpen && <Text dimColor>│</Text>}
      {isOpen && <Button key="quote" label={say.quote} hotkey="q" variant="primary" onPress={() => quoteSelection($, say)} />}
      {isOpen && buttons}
      {isOpen && !isBehind && state.back.length > 0 && <Button key="back" label={say.back} hotkey="b" onPress={() => goBack($, say)} />}
      {isOpen && <Button key="close" label={say.close} dimColor onPress={() => closePane($)} />}
      {offered && <Button key="offer" label={say.open(offered.label)} hotkey="o" onPress={openOffered} />}
      {offered && <Button key="dismiss" label={say.dismiss} dimColor onPress={() => dismissOffer($)} />}
    </Box>
  )
}

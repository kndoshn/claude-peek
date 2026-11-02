// The pane: the view the band chose, or how to open that view when it never showed anything.

import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { messages } from '../messages'
import { navState } from '../nav'
import { shownCommand } from '../views/command'
import { shownFile } from '../views/file'
import { drawCommand } from './command'
import { drawFile } from './file'

type Api = EngineInterface

export async function drawPane($: Api, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const say = await messages($)
  const state = await navState($)
  if (state.view === 'file') {
    const shown = await shownFile($)
    if (shown) return drawFile($, e, say, shown)
  }
  if (state.view === 'command') {
    const shown = await shownCommand($)
    if (shown) return drawCommand($, e, say, shown)
  }
  const { Box, Text } = $.ui.resolve(e)
  const hint = state.view === 'command' ? say.commandHint : say.emptyPane
  return (
    <Box key="hint">
      <Text dimColor>{hint}</Text>
    </Box>
  )
}

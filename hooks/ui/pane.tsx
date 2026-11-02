// The pane: the view the band chose.

import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { messages } from '../messages'
import { navState } from '../nav'
import { shownFile } from '../views/file'
import { drawFile } from './file'

type Api = EngineInterface

export async function drawPane($: Api, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const say = await messages($)
  const state = await navState($)
  if (state.view === 'file') {
    const shown = await shownFile($)
    if (shown) return drawFile($, e, say, shown)
  }
  const { Text } = $.ui.resolve(e)
  return <Text dimColor>{say.emptyPane}</Text>
}

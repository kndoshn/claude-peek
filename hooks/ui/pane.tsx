// The pane: the view the band chose, or how to open that view when it never showed anything (a
// file; the tree and Git open at the working directory).

import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { messages } from '../messages'
import { navState } from '../nav'
import { shownFile } from '../views/file'
import { shownGit } from '../views/git'
import { shownTree } from '../views/tree'
import { drawFile } from './file'
import { drawGit } from './git'
import { drawTree } from './tree'

type Api = EngineInterface

export async function drawPane($: Api, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const say = await messages($)
  const state = await navState($)
  if (state.view === 'file') {
    const shown = await shownFile($)
    if (shown) return drawFile($, e, say, shown)
  }
  if (state.view === 'tree') {
    const shown = await shownTree($)
    if (shown) return drawTree($, e, say, shown)
  }
  if (state.view === 'git') {
    const shown = await shownGit($)
    if (shown) return drawGit($, e, say, shown)
  }
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box key="hint">
      <Text dimColor>{say.emptyPane}</Text>
    </Box>
  )
}

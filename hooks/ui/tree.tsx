// The tree view in the pane: the folder and its branch, then a row a line, each a button.

import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { TreeState } from '../../types'
import type { Messages } from '../messages'
import { follow } from '../nav'
import { treeRows } from '../pure/tree'
import type { TreeRow } from '../pure/tree'
import { showAll, toggleFolder } from '../views/tree'

type Api = EngineInterface

// The colour of each Git mark.
const BADGE_COLORS: Record<string, string> = { M: 'warning', A: 'success', D: 'error', R: 'warning', '•': 'warning' }

export async function drawTree($: Api, e: RenderInput<'Pane'>, say: Messages, shown: TreeState): Promise<RenderElement> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const { rows, isCut } = treeRows(shown)

  const press = (row: TreeRow) => {
    if (row.kind === 'more') return showAll($, row.path)
    if (row.kind === 'dir') return toggleFolder($, row.path)
    return follow($, say, { view: 'file', path: `${shown.root}/${row.path}` })
  }
  const line = (row: TreeRow) => {
    const dim = row.isIgnored ? { dimColor: true as const } : {}
    if (row.kind === 'more') {
      return (
        <Button key={`more:${row.path}`} plain dimColor onPress={() => press(row)}>
          <Text dimColor>{row.prefix}</Text>
          <Text>{say.more(row.hidden ?? 0)}</Text>
        </Button>
      )
    }
    const isChosen = row.kind === 'dir' && row.path === shown.selected
    return (
      <Button key={`tree:${row.path}`} plain {...dim} onPress={() => press(row)}>
        <Text dimColor>{row.prefix}</Text>
        <Text {...dim} {...(row.kind === 'dir' ? { color: 'suggestion' } : {})} {...(isChosen ? { weight: 'bold' as const } : {})}>
          {`${row.name}${row.kind === 'dir' ? '/' : ''}`}
        </Text>
        {row.badge ? <Text color={BADGE_COLORS[row.badge] ?? 'inactive'}>{` ${row.badge}`}</Text> : null}
      </Button>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box key="header">
        <Text wrap="truncate-start">
          <Text weight="bold">{shown.label}</Text>
          {shown.branch ? <Text dimColor>{` · ${shown.branch}`}</Text> : null}
          {isCut && <Text color="warning">{` · ${say.cut}`}</Text>}
        </Text>
      </Box>
      <Box flexDirection="column">{rows.map(line)}</Box>
    </Box>
  )
}

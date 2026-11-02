// The command view in the pane: the command and how it ended, then its output and its errors.

import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { CommandRun } from '../../types'
import type { Messages } from '../messages'
import { clip, DRAW_LIMIT } from '../pure/markdown'

type Api = EngineInterface

export async function drawCommand($: Api, e: RenderInput<'Pane'>, say: Messages, shown: CommandRun): Promise<RenderElement> {
  const { Box, Code, Text } = $.ui.resolve(e)
  const output = clip(shown.stdout, DRAW_LIMIT)
  const errors = clip(shown.stderr, Math.max(DRAW_LIMIT - output.text.length, 0))
  const isCut = output.isCut || errors.isCut
  const ended =
    shown.stoppedAfter !== undefined ? (
      <Text color="warning">{` · ${say.stoppedAfter(shown.stoppedAfter)}`}</Text>
    ) : shown.exitCode === null ? (
      <Text color="error">{` · ${say.failed}`}</Text>
    ) : (
      <Text {...(shown.exitCode === 0 ? { dimColor: true } : { color: 'error' })}>{` · ${say.exit(shown.exitCode)}`}</Text>
    )

  return (
    <Box flexDirection="column" gap={1}>
      <Box key="header">
        <Text>
          <Text weight="bold">{`$ ${shown.command}`}</Text>
          {ended}
          {isCut && <Text color="warning">{` · ${say.cut}`}</Text>}
        </Text>
      </Box>
      {output.text !== '' && <Code source={output.text} />}
      {errors.text.trim() !== '' && <Text dimColor>{say.stderr}</Text>}
      {errors.text.trim() !== '' && <Code source={errors.text} />}
      {output.text === '' && errors.text.trim() === '' && <Text dimColor>{say.noOutput}</Text>}
    </Box>
  )
}

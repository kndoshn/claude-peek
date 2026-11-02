// The file view in the pane: a header, then the file rendered, as source, or as its changes.

import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { FileDoc } from '../../types'
import type { Messages } from '../messages'
import { follow } from '../nav'
import { hunks, lines } from '../pure/diff'
import { clip, DRAW_LIMIT, frontMatter, linkify } from '../pure/markdown'
import { dirname } from '../pure/paths'
import { visible } from '../pure/terminal'
import { changesOf, LINE_KEY } from '../views/file'

type Api = EngineInterface
// Of that, how much comes before the lines a file was opened at.
const BEFORE_LIMIT = 20_000
// The most links in one drawing the pane answers.
const MAX_LINKS = 256
// The background of the lines a file was opened at: the theme's, as a message of the person's.
const MARK_BACKGROUND = 'userMessageBackground'

// The file's lines split around `at`, each part with the number of its first line, cut to fit a
// drawing: some lines before, the marked lines, and what fits after.
function around(text: string, at: [number, number]): { parts: { start: number; text: string; isMarked: boolean }[]; isCut: boolean } {
  const all = text.replace(/\n$/, '').split('\n')
  const from = Math.min(at[0], all.length)
  const to = Math.min(Math.max(at[1], from), all.length)
  let before = all.slice(0, from - 1)
  let isCut = false
  while (before.join('\n').length > BEFORE_LIMIT) {
    before = before.slice(Math.ceil(before.length / 2))
    isCut = true
  }
  const marked = all.slice(from - 1, to)
  let after = all.slice(to)
  const room = DRAW_LIMIT - before.join('\n').length - marked.join('\n').length
  while (after.length > 0 && after.join('\n').length > room) {
    after = after.slice(0, Math.floor(after.length / 2))
    isCut = true
  }
  const parts = [{ start: from, text: marked.join('\n'), isMarked: true }]
  if (before.length > 0) parts.unshift({ start: from - before.length, text: before.join('\n'), isMarked: false })
  if (after.length > 0) parts.push({ start: to + 1, text: after.join('\n'), isMarked: false })
  return { parts, isCut }
}

export async function drawFile($: Api, e: RenderInput<'Pane'>, say: Messages, shown: FileDoc): Promise<RenderElement> {
  const { Box, Code, Markdown, Text } = $.ui.resolve(e)
  // The file as a drawing takes it: a control character shown, each line where it was; its path
  // too, which only names the language.
  const text = visible(shown.text)
  const path = visible(shown.path)

  const notes = [say.lineCount(lines(shown.text).length)]
  let isCut = false
  let body: RenderElement
  if (shown.mode === 'changes') {
    notes.push(say.changesView)
    const drawn = clip(visible(hunks(changesOf(shown))), DRAW_LIMIT, '\n@@')
    isCut = drawn.isCut
    body = drawn.text ? <Code source={drawn.text} format="diff" /> : <Text dimColor>{say.noChanges}</Text>
  } else if (shown.mode === 'source') {
    if (shown.isMarkdown) notes.push(say.sourceView)
    if (shown.lines) {
      notes.push(say.atLines(shown.lines))
      const split = around(text, shown.lines)
      isCut = split.isCut
      body = (
        <Box flexDirection="column">
          {split.parts.map(part =>
            part.isMarked ? (
              <Box key={LINE_KEY} backgroundColor={MARK_BACKGROUND}>
                <Code source={part.text} path={path} startLine={part.start} />
              </Box>
            ) : (
              <Code source={part.text} path={path} startLine={part.start} />
            ),
          )}
        </Box>
      )
    } else {
      const drawn = clip(text, DRAW_LIMIT)
      isCut = drawn.isCut
      body = <Code source={drawn.text} path={path} startLine={1} />
    }
  } else {
    const drawn = clip(text, DRAW_LIMIT)
    isCut = drawn.isCut
    const { text: markdown, links } = linkify(frontMatter(drawn.text), dirname(shown.path))
    const pressable = [...links.keys()].slice(0, MAX_LINKS)
    const press = (link: { href: string }) => {
      const path = links.get(link.href)
      if (path) return follow($, say, { view: 'file', path })
    }
    body = pressable.length ? (
      <Markdown key="doc" text={markdown} pressableLinks={pressable} onLinkPress={press} />
    ) : (
      <Markdown key="doc" text={markdown} />
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box key="header">
        <Text wrap="truncate-start">
          <Text weight="bold">{visible(shown.label)}</Text>
          <Text dimColor>{notes.map(note => ` · ${note}`).join('')}</Text>
          {shown.isDeleted && <Text color="error">{` · ${say.deleted}`}</Text>}
          {isCut && <Text color="warning">{` · ${say.cut}`}</Text>}
        </Text>
      </Box>
      {body}
    </Box>
  )
}

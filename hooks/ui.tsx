// What md-review draws: the pane with the shown file, and the band above the prompt.

import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { count, hunks, lines } from './diff'
import {
  changesOf,
  close,
  dismissOffer,
  follow,
  goBack,
  offeredFile,
  openOffered,
  quoteSelection,
  shownDoc,
  toggleView,
} from './doc'
import { clip, frontMatter, linkify } from './markdown'
import { messages } from './messages'
import { dirname } from './paths'

type Api = EngineInterface

// The most text the pane draws, under the 100000 characters a drawing takes.
const DRAW_LIMIT = 90_000
// The most links in one drawing the pane answers.
const MAX_LINKS = 256

// The pane: a header with the file, its line count and the view, then the file in that view.
export async function drawPane($: Api, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const { Box, Button, Code, Markdown, Text } = $.ui.resolve(e)
  const say = await messages($)
  const shown = await shownDoc($)
  if (!shown) return <Text dimColor>{say.emptyPane}</Text>

  const notes = [say.lineCount(lines(shown.text).length)]
  let isCut = false
  let body: RenderElement
  if (shown.view === 'source') {
    notes.push(say.sourceView)
    const drawn = clip(shown.text, DRAW_LIMIT)
    isCut = drawn.isCut
    body = <Code source={drawn.text} language="markdown" startLine={1} />
  } else if (shown.view === 'changes') {
    notes.push(say.changesView)
    const drawn = clip(hunks(changesOf(shown)), DRAW_LIMIT, '\n@@')
    isCut = drawn.isCut
    body = drawn.text ? <Code source={drawn.text} format="diff" /> : <Text dimColor>{say.noChanges}</Text>
  } else {
    const drawn = clip(shown.text, DRAW_LIMIT)
    isCut = drawn.isCut
    const { text, links } = linkify(frontMatter(drawn.text), dirname(shown.path))
    const pressable = [...links.keys()].slice(0, MAX_LINKS)
    const press = (link: { href: string }) => {
      const target = links.get(link.href)
      if (target) return follow($, say, target)
    }
    body = pressable.length ? (
      <Markdown key="doc" text={text} pressableLinks={pressable} onLinkPress={press} />
    ) : (
      <Markdown key="doc" text={text} />
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between" gap={1}>
        <Box key="header" flexShrink={1}>
          <Text>
            <Text weight="bold">{shown.label}</Text>
            <Text dimColor>{notes.map(note => ` · ${note}`).join('')}</Text>
            {shown.isDeleted && <Text color="error">{` · ${say.deleted}`}</Text>}
            {isCut && <Text color="warning">{` · ${say.cut}`}</Text>}
          </Text>
        </Box>
        {/* The engine's own close mark is one cell wide; this is a wider target. */}
        <Button key="pane-close" label={say.closePane} hotkey="x" onPress={() => close($)} />
      </Box>
      {body}
    </Box>
  )
}

// The band: the shown file's buttons and the offer, or undefined when there is neither.
export async function drawBand($: Api, e: RenderInput<'AbovePrompt'>): Promise<RenderElement | undefined> {
  const shown = await shownDoc($)
  const offered = await offeredFile($)
  if (e.props.hasSurvey || (!shown && !offered)) return undefined
  const { Box, Button, Text } = $.ui.resolve(e)
  const say = await messages($)
  const { added, removed } = shown ? count(changesOf(shown)) : { added: 0, removed: 0 }

  return (
    <Box gap={1} flexWrap="wrap">
      {shown && <Text dimColor>{shown.label}</Text>}
      {shown && <Button key="quote" label={say.quote} hotkey="q" variant="primary" onPress={() => quoteSelection($, say)} />}
      {shown && (
        <Button
          key="source"
          label={shown.view === 'source' ? say.rendered : say.source}
          hotkey="s"
          onPress={() => toggleView($, 'source')}
        />
      )}
      {shown && (shown.view === 'changes' || added + removed > 0) && (
        <Button
          key="changes"
          label={shown.view === 'changes' ? say.hideChanges : say.changes(added, removed)}
          hotkey="d"
          onPress={() => toggleView($, 'changes')}
        />
      )}
      {shown && shown.back.length > 0 && <Button key="back" label={say.back} hotkey="b" onPress={() => goBack($, say)} />}
      {shown && <Button key="close" label={say.close} dimColor onPress={() => close($)} />}
      {offered && <Button key="offer" label={say.open(offered.label)} hotkey="o" onPress={() => openOffered($, say)} />}
      {offered && <Button key="dismiss" label={say.dismiss} dimColor onPress={() => dismissOffer($)} />}
    </Box>
  )
}

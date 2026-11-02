// The Git view in the pane: the branch, the changes by kind and the history, or a commit opened
// from it with its details and its diff by file.

import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { GitState } from '../../types'
import type { Messages } from '../messages'
import { follow } from '../nav'
import { clip, DRAW_LIMIT } from '../pure/markdown'

type Api = EngineInterface

// The colour of each kind of change.
const MARK_COLORS: Record<string, string> = { M: 'warning', A: 'success', D: 'error', R: 'warning', C: 'warning', U: 'error', '?': 'inactive' }

// The header: the repository, its branch with how far it is ahead of and behind its upstream, and
// the stash.
function heading(shown: GitState, say: Messages): string {
  const s = shown.status
  const branch = s.branch ?? say.detached(s.oid)
  const counts = s.upstream ? [s.ahead ? `↑${s.ahead}` : '', s.behind ? `↓${s.behind}` : ''].filter(Boolean).join(' ') : ''
  return [shown.label, counts ? `${branch} ${counts}` : branch, ...(s.stash ? [say.stash(s.stash)] : [])].join(' · ')
}

export async function drawGit($: Api, e: RenderInput<'Pane'>, say: Messages, shown: GitState): Promise<RenderElement> {
  const { Box, Button, Code, Text } = $.ui.resolve(e)

  if (shown.commit) {
    const commit = shown.commit
    let room = DRAW_LIMIT - commit.stat.length
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="header">
          <Text>
            <Text color="warning">{commit.hash}</Text>
            <Text weight="bold">{` ${commit.subject}`}</Text>
          </Text>
        </Box>
        <Text dimColor>{`${commit.author} · ${commit.date}`}</Text>
        {commit.body ? <Text>{commit.body}</Text> : null}
        {commit.stat ? <Code source={commit.stat} /> : null}
        {commit.files.map(file => {
          const drawn = clip(file.hunks, Math.max(room, 0), '\n@@')
          room -= drawn.text.length
          return (
            <Box key={`file:${file.path}`} flexDirection="column">
              <Text weight="bold">{file.path}</Text>
              {drawn.text ? <Code source={drawn.text} format="diff" /> : <Text dimColor>{file.note || say.cut}</Text>}
            </Box>
          )
        })}
      </Box>
    )
  }

  const s = shown.status
  const fileRow = (kind: 'staged' | 'unstaged' | 'untracked', path: string, mark: string) => (
    <Button key={`git-file:${kind}:${path}`} plain onPress={() => follow($, say, { view: 'file', path: `${shown.root}/${path}` })}>
      <Text color={MARK_COLORS[mark] ?? 'inactive'}>{mark}</Text>
      <Text>{` ${path}`}</Text>
    </Button>
  )
  const section = (title: string, rows: RenderElement[]) =>
    rows.length ? (
      <Box key={`section:${title}`} flexDirection="column">
        <Text dimColor>{title}</Text>
        {rows}
      </Box>
    ) : null
  const isClean = s.staged.length + s.unstaged.length + s.untracked.length === 0

  return (
    <Box flexDirection="column" gap={1}>
      <Box key="header">
        <Text weight="bold">{heading(shown, say)}</Text>
      </Box>
      {section(say.staged(s.staged.length), s.staged.map(f => fileRow('staged', f.path, f.mark)))}
      {section(say.unstaged(s.unstaged.length), s.unstaged.map(f => fileRow('unstaged', f.path, f.mark)))}
      {section(say.untracked(s.untracked.length), s.untracked.map(path => fileRow('untracked', path, '?')))}
      {isClean ? <Text dimColor>{say.nothingToCommit}</Text> : null}
      <Text dimColor>{say.diffHint}</Text>
      <Box flexDirection="column">
        <Text dimColor>{say.history}</Text>
        {shown.log.length === 0 ? <Text dimColor>{say.noCommits}</Text> : null}
        {shown.log.map((line, i) =>
          line.commit ? (
            <Button
              key={`commit:${line.commit.hash}`}
              plain
              onPress={() => follow($, say, { view: 'git', commit: line.commit?.hash ?? '' })}
            >
              <Text dimColor>{line.graph}</Text>
              <Text color="warning">{` ${line.commit.hash}`}</Text>
              {line.commit.refs ? <Text color="success">{` (${line.commit.refs})`}</Text> : null}
              <Text>{` ${line.commit.subject}`}</Text>
              <Text dimColor>{` ${line.commit.age}`}</Text>
            </Button>
          ) : (
            <Box key={`graph:${i}`}>
              <Text dimColor>{line.graph}</Text>
            </Box>
          ),
        )}
      </Box>
    </Box>
  )
}

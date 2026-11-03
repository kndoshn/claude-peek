// What peek says, in each language it speaks, and which language that is.

import type { EngineInterface } from 'claude-code'

import type { ViewName } from '../types'

type Lang = 'en' | 'ja'

export type Messages = {
  peekCommand: string
  peekArgument: string
  mdCommand: string
  mdArgument: string
  opened: (label: string) => string
  notMarkdown: (path: string) => string
  notText: (path: string) => string
  tooLarge: (path: string) => string
  unreadable: (path: string) => string
  noneRecentMarkdown: string
  notFound: (query: string) => string
  emptyPane: string
  selectFirst: string
  views: Record<ViewName, string>
  quote: string
  close: string
  open: (label: string) => string
  dismiss: string
  source: string
  rendered: string
  changes: (added: number, removed: number) => string
  hideChanges: string
  mention: string
  back: string
  lineCount: (count: number) => string
  atLines: (lines: [number, number]) => string
  sourceView: string
  changesView: string
  noChanges: string
  deleted: string
  cut: string
  copy: string
  copied: string
  notFolder: (path: string) => string
  more: (hidden: number) => string
  quoteTree: string
  notRepo: string
  noCommit: (hash: string) => string
  staged: (n: number) => string
  unstaged: (n: number) => string
  untracked: (n: number) => string
  nothingToCommit: string
  history: string
  noCommits: string
  diffHint: string
  detached: (oid: string | null) => string
  stash: (n: number) => string
  commitToPrompt: string
  refresh: string
  treeCommand: string
  treeArgument: string
  gitCommand: string
}

const MESSAGES: Record<Lang, Messages> = {
  en: {
    peekCommand: 'Peek at a file, a folder or Git in a pane, and quote what you need',
    peekArgument: '[path[:line] | name | git]',
    mdCommand: 'Read a Markdown file in the pane (no path: the latest .md Claude named)',
    mdArgument: '[path or part of a name]',
    opened: label => `Opened ${label}`,
    notMarkdown: path => `Not a Markdown file: ${path}`,
    notText: path => `Not a text file: ${path}`,
    tooLarge: path => `Too large to show (over 4 MiB): ${path}`,
    unreadable: path => `Cannot read ${path}`,
    noneRecentMarkdown: 'No .md file in the recent conversation. Name one: /md <path>',
    notFound: query => `Nothing matches "${query}". Give a path or part of a name.`,
    emptyPane: '/peek [path] shows a file here',
    selectFirst: 'Select a passage in the pane with the mouse first',
    views: { file: 'File', tree: 'Tree', git: 'Git' },
    quote: 'Quote selection',
    close: 'Close',
    open: label => `Open ${label}`,
    dismiss: '×',
    source: 'Source',
    rendered: 'Rendered',
    changes: (added, removed) => `Changes +${added} −${removed}`,
    hideChanges: 'Hide changes',
    mention: '@ path',
    back: '← Back',
    lineCount: count => (count === 1 ? '1 line' : `${count} lines`),
    atLines: ([from, to]) => (from === to ? `line ${from}` : `lines ${from}-${to}`),
    sourceView: 'source',
    changesView: 'changes since your last message',
    noChanges: 'No changes since your last message',
    deleted: 'deleted on disk',
    cut: 'too long: cut to fit',
    copy: 'Copy',
    copied: 'Copied',
    notFolder: path => `Not a folder: ${path}`,
    more: hidden => `… ${hidden} more`,
    quoteTree: 'Quote tree',
    notRepo: 'Not in a git repository',
    noCommit: hash => `Cannot read commit ${hash}`,
    staged: n => `Staged (${n})`,
    unstaged: n => `Not staged (${n})`,
    untracked: n => `Untracked (${n})`,
    nothingToCommit: 'Nothing to commit',
    history: 'History',
    noCommits: 'No commits yet',
    diffHint: 'Diffs of the work in progress: /diff',
    detached: oid => (oid ? `detached at ${oid.slice(0, 7)}` : 'detached'),
    stash: n => `stash ${n}`,
    commitToPrompt: 'Commit to prompt',
    refresh: 'Refresh',
    treeCommand: 'Show a folder as a tree in the pane (no folder: the working directory)',
    treeArgument: '[folder or part of a name]',
    gitCommand: "Show the repository's status and history in the pane",
  },
  ja: {
    peekCommand: 'ファイル・フォルダー・Git をパネルで覗き、必要な箇所を引用する',
    peekArgument: '[パス[:行] | 名前の一部 | git]',
    mdCommand: 'Markdown をパネルで読む（パスなしで直近の .md）',
    mdArgument: '[パスか名前の一部]',
    opened: label => `${label} をパネルで開きました`,
    notMarkdown: path => `.md ではないので開きません: ${path}`,
    notText: path => `テキストのファイルではないので開きません: ${path}`,
    tooLarge: path => `大きすぎるので開きません（4 MiB 超）: ${path}`,
    unreadable: path => `読めません: ${path}`,
    noneRecentMarkdown: '直近の会話に .md が見つかりません。/md <path> で指定してください',
    notFound: query => `見つかりません: ${query}（パスか、名前の一部を指定してください）`,
    emptyPane: '/peek [path] でファイルを表示します',
    selectFirst: '引用する箇所を先にマウスで選択してください',
    views: { file: 'ファイル', tree: 'ツリー', git: 'Git' },
    quote: '選択を引用',
    close: '閉じる',
    open: label => `開く: ${label}`,
    dismiss: '×',
    source: 'ソース',
    rendered: '整形',
    changes: (added, removed) => `変更 +${added} −${removed}`,
    hideChanges: '変更を閉じる',
    mention: '@パス',
    back: '← 戻る',
    lineCount: count => `${count} 行`,
    atLines: ([from, to]) => (from === to ? `${from} 行目` : `${from}-${to} 行目`),
    sourceView: 'ソース',
    changesView: '前回の送信からの変更',
    noChanges: '前回の送信からの変更はありません',
    deleted: 'ディスクから削除されました',
    cut: '長いので途中まで表示',
    copy: 'コピー',
    copied: 'コピーしました',
    notFolder: path => `フォルダーではありません: ${path}`,
    more: hidden => `…ほか ${hidden} 件`,
    quoteTree: 'ツリーを引用',
    notRepo: 'git のリポジトリではありません',
    noCommit: hash => `コミットを読めません: ${hash}`,
    staged: n => `ステージ済み (${n})`,
    unstaged: n => `未ステージ (${n})`,
    untracked: n => `未追跡 (${n})`,
    nothingToCommit: 'コミットするものはありません',
    history: '履歴',
    noCommits: 'まだコミットがありません',
    diffHint: '作業中の差分は /diff で見られます',
    detached: oid => (oid ? `detached（${oid.slice(0, 7)}）` : 'detached'),
    stash: n => `stash ${n}`,
    commitToPrompt: 'コミットを入れる',
    refresh: '更新',
    treeCommand: 'フォルダーをツリーでパネルに表示する（フォルダーなしで作業ディレクトリ）',
    treeArgument: '[フォルダーか名前の一部]',
    gitCommand: 'リポジトリの状態と履歴をパネルに表示する',
  },
}

// The language a setting (`japanese`, `日本語`) or locale (`ja_JP.UTF-8`) names, if it is one
// peek speaks.
function languageOf(value: string | undefined): Lang | undefined {
  const v = value?.trim() ?? ''
  if (/^(ja|japanese)(?![a-z])|^日本語/i.test(v)) return 'ja'
  if (/^(en|english)(?![a-z])/i.test(v)) return 'en'
  return undefined
}

// The language option as set (auto, en or ja), and the language auto came to.
let configured = 'auto'
let detected: Lang | undefined

// Takes the language option of this load of the module.
export function configureLanguage(option: unknown): void {
  configured = String(option ?? 'auto')
  detected = undefined
}

// The language set in the options; with auto, Claude Code's language setting, then the locale.
async function language($: EngineInterface): Promise<Lang> {
  const chosen = languageOf(configured)
  if (chosen) return chosen
  if (detected) return detected
  const rows = await $.config.list().catch(() => [])
  const setting = rows.find(row => row.key === 'language')?.value
  const locale =
    (await $.env.get('LC_ALL').catch(() => undefined)) ||
    (await $.env.get('LC_MESSAGES').catch(() => undefined)) ||
    (await $.env.get('LANG').catch(() => undefined))
  detected = languageOf(typeof setting === 'string' ? setting : undefined) ?? languageOf(locale) ?? 'en'
  return detected
}

export async function messages($: EngineInterface): Promise<Messages> {
  return MESSAGES[await language($)]
}

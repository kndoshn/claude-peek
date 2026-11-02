// What peek says, in each language it speaks, and which language that is.

import type { EngineInterface } from 'claude-code'

import type { ViewName } from '../types'

export type Lang = 'en' | 'ja'

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
  noneRecent: string
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
  commandHint: string
  exit: (code: number) => string
  stoppedAfter: (seconds: number) => string
  noOutput: string
  stderr: string
  quoteAll: string
  rerun: string
  copy: string
  copied: string
  failed: string
}

export const MESSAGES: Record<Lang, Messages> = {
  en: {
    peekCommand: 'Peek at a file, a folder, Git or a command in a pane, and quote what you need',
    peekArgument: '[path[:line] | name | git | !command]',
    mdCommand: 'Read a Markdown file in the pane (no path: the latest .md Claude named)',
    mdArgument: '[path or part of a name]',
    opened: label => `Opened ${label}`,
    notMarkdown: path => `Not a Markdown file: ${path}`,
    notText: path => `Not a text file: ${path}`,
    tooLarge: path => `Too large to show (over 4 MiB): ${path}`,
    unreadable: path => `Cannot read ${path}`,
    noneRecentMarkdown: 'No .md file in the recent conversation. Name one: /md <path>',
    noneRecent: 'No file in the recent conversation. Name one: /peek <path>',
    notFound: query => `Nothing matches "${query}". Give a path or part of a name.`,
    emptyPane: '/peek [path] shows a file here',
    selectFirst: 'Select a passage in the pane with the mouse first',
    views: { file: 'File', tree: 'Tree', git: 'Git', command: 'Command' },
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
    commandHint: '/peek !ls -la runs a command and shows its output here',
    exit: code => `exit ${code}`,
    stoppedAfter: seconds => `stopped after ${seconds} s`,
    noOutput: 'no output',
    stderr: 'stderr',
    quoteAll: 'Quote output',
    rerun: 'Run again',
    copy: 'Copy',
    copied: 'Copied',
    failed: 'could not run',
  },
  ja: {
    peekCommand: 'ファイル・フォルダー・Git・コマンドの出力をパネルで覗き、必要な箇所を引用する',
    peekArgument: '[パス[:行] | 名前の一部 | git | !コマンド]',
    mdCommand: 'Markdown をパネルで読む（パスなしで直近の .md）',
    mdArgument: '[パスか名前の一部]',
    opened: label => `${label} をパネルで開きました`,
    notMarkdown: path => `.md ではないので開きません: ${path}`,
    notText: path => `テキストのファイルではないので開きません: ${path}`,
    tooLarge: path => `大きすぎるので開きません（4 MiB 超）: ${path}`,
    unreadable: path => `読めません: ${path}`,
    noneRecentMarkdown: '直近の会話に .md が見つかりません。/md <path> で指定してください',
    noneRecent: '直近の会話にファイルが見つかりません。/peek <path> で指定してください',
    notFound: query => `見つかりません: ${query}（パスか、名前の一部を指定してください）`,
    emptyPane: '/peek [path] でファイルを表示します',
    selectFirst: '引用する箇所を先にマウスで選択してください',
    views: { file: 'ファイル', tree: 'ツリー', git: 'Git', command: 'コマンド' },
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
    commandHint: '/peek !ls -la でコマンドを実行し、出力をここに表示します',
    exit: code => `終了コード ${code}`,
    stoppedAfter: seconds => `${seconds} 秒で止めました`,
    noOutput: '出力なし',
    stderr: '標準エラー出力',
    quoteAll: '出力を引用',
    rerun: '再実行',
    copy: 'コピー',
    copied: 'コピーしました',
    failed: '実行できませんでした',
  },
}

// The language a setting (`japanese`, `日本語`) or locale (`ja_JP.UTF-8`) names, if it is one
// peek speaks.
export function languageOf(value: string | undefined): Lang | undefined {
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

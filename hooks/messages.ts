// What md-review says, in each language it speaks, and which language that is.

import type { EngineInterface } from 'claude-code'

export type Lang = 'en' | 'ja'

export type Messages = {
  command: string
  argument: string
  opened: (label: string) => string
  notMarkdown: (path: string) => string
  unreadable: (path: string) => string
  noneRecent: string
  notFound: (query: string) => string
  emptyPane: string
  selectFirst: string
  quote: string
  close: string
  open: (label: string) => string
  dismiss: string
  source: string
  rendered: string
  changes: (added: number, removed: number) => string
  hideChanges: string
  back: string
  lineCount: (count: number) => string
  sourceView: string
  changesView: string
  noChanges: string
  deleted: string
  cut: string
}

export const MESSAGES: Record<Lang, Messages> = {
  en: {
    command: 'Read a Markdown file in a pane (no path: the latest .md Claude named)',
    argument: '[path or part of a name]',
    opened: label => `Opened ${label}`,
    notMarkdown: path => `Not a Markdown file: ${path}`,
    unreadable: path => `Cannot read ${path}`,
    noneRecent: 'No .md file in the recent conversation. Name one: /md <path>',
    notFound: query => `No Markdown file matches "${query}". Give a path or part of a file name.`,
    emptyPane: '/md [path] opens a Markdown file here',
    selectFirst: 'Select a passage in the pane with the mouse first',
    quote: 'Quote selection',
    close: 'Close',
    open: label => `Open ${label}`,
    dismiss: '×',
    source: 'Source',
    rendered: 'Rendered',
    changes: (added, removed) => `Changes +${added} −${removed}`,
    hideChanges: 'Hide changes',
    back: '← Back',
    lineCount: count => (count === 1 ? '1 line' : `${count} lines`),
    sourceView: 'source',
    changesView: 'changes since your last message',
    noChanges: 'No changes since your last message',
    deleted: 'deleted on disk',
    cut: 'too long: cut to fit',
  },
  ja: {
    command: 'Markdown を横のパネルで読む（パスなしで直近の .md）',
    argument: '[パスか名前の一部]',
    opened: label => `${label} をパネルで開きました`,
    notMarkdown: path => `.md ではないので開きません: ${path}`,
    unreadable: path => `読めません: ${path}`,
    noneRecent: '直近の会話に .md が見つかりません。/md <path> で指定してください',
    notFound: query => `見つかりません: ${query}（.md のパスか、ファイル名の一部を指定してください）`,
    emptyPane: '/md [path] で Markdown を開きます',
    selectFirst: '引用する箇所を先にマウスで選択してください',
    quote: '選択を引用',
    close: '閉じる',
    open: label => `開く: ${label}`,
    dismiss: '×',
    source: 'ソース',
    rendered: '整形',
    changes: (added, removed) => `変更 +${added} −${removed}`,
    hideChanges: '変更を閉じる',
    back: '← 戻る',
    lineCount: count => `${count} 行`,
    sourceView: 'ソース',
    changesView: '前回の送信からの変更',
    noChanges: '前回の送信からの変更はありません',
    deleted: 'ディスクから削除されました',
    cut: '長いので途中まで表示',
  },
}

// The language a setting (`japanese`, `日本語`) or locale (`ja_JP.UTF-8`) names, if it is one
// md-review speaks.
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

// What md-review says, in each language it speaks.

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
  reload: string
  close: string
  open: (label: string) => string
  dismiss: string
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
    reload: 'Reload',
    close: 'Close',
    open: label => `Open ${label}`,
    dismiss: '×',
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
    reload: '再読込',
    close: '閉じる',
    open: label => `開く: ${label}`,
    dismiss: '×',
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

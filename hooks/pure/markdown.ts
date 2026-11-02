// Preparing Markdown for the pane: links it answers, front matter, and a cut to what one
// drawing takes. Pure.

import { normalize } from './paths'

// The most text the pane draws, under the 100000 characters a drawing takes.
export const DRAW_LIMIT = 90_000

// Where a link leads: a file or folder, and the lines a GitHub anchor (`#L10`, `#L10-L20`) names.
export type Linked = { path: string; lines?: [number, number] }

// The file: href of a relative link target and where it leads, resolved from `dir`, or undefined
// for a URL, an anchor alone or a root path. The query and any other anchor are dropped.
function linkTarget(target: string, dir: string): { href: string; linked: Linked } | undefined {
  const written = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
  if (/^[a-z][a-z0-9+.-]*:/i.test(written) || written.startsWith('#') || written.startsWith('/')) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(written.replace(/[?#].*$/, ''))
  } catch {
    return undefined
  }
  if (!decoded) return undefined
  const path = normalize(`${dir}/${decoded}`)
  const anchor = /#L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?)?$/.exec(written)
  const from = Number(anchor?.[1])
  const to = Number(anchor?.[2] ?? anchor?.[1])
  if (!anchor || from < 1 || to < 1) return { href: `file://${encodeURI(path)}`, linked: { path } }
  const lines: [number, number] = [Math.min(from, to), Math.max(from, to)]
  const fragment = lines[0] === lines[1] ? `#L${lines[0]}` : `#L${lines[0]}-L${lines[1]}`
  return { href: `file://${encodeURI(path)}${fragment}`, linked: { path, lines } }
}

// Relative links to files and folders (inline, in angle brackets, or by a reference definition)
// turned into file: links the pane answers, resolved from `dir`; links in code, images and
// other targets left as written. Returns the text and where each new link leads by its href.
export function linkify(markdown: string, dir: string): { text: string; links: Map<string, Linked> } {
  const links = new Map<string, Linked>()
  const answer = (target: string) => {
    const found = linkTarget(target, dir)
    if (found) links.set(found.href, found.linked)
    return found?.href
  }
  const inline = /(!?)\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(\s+"[^"]*")?\s*\)/g
  const definition = /^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]*>|\S+)(.*)$/
  const rewrite = (segment: string) =>
    segment.replace(inline, (whole, bang: string, label: string, target: string, title: string | undefined) => {
      const href = bang ? undefined : answer(target)
      return href ? `[${label}](${href}${title ?? ''})` : whole
    })
  let fence: string | undefined
  const out = markdown.split('\n').map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
      return line
    }
    if (marker) {
      fence = marker
      return line
    }
    const defined = definition.exec(line)
    if (defined) {
      const href = answer(defined[2] ?? '')
      return href ? `${defined[1]}${href}${defined[3]}` : line
    }
    // Leave inline code spans alone.
    return line
      .split(/(`+[^`]*`+)/)
      .map(part => (part.startsWith('`') ? part : rewrite(part)))
      .join('')
  })
  return { text: out.join('\n'), links }
}

// YAML front matter at the top (after a byte order mark, if any) drawn as a YAML code block rather
// than a rule and a paragraph.
export function frontMatter(markdown: string): string {
  const found = /^\ufeff?---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown)
  if (!found) return markdown
  return `\`\`\`yaml\n${found[1]}\n\`\`\`\n${markdown.slice(found[0].length)}`
}

// The text cut to at most `limit` characters after a line (for a diff, `unit` '\n@@' cuts after
// a hunk), and whether it was cut.
export function clip(text: string, limit: number, unit = '\n'): { text: string; isCut: boolean } {
  if (text.length <= limit) return { text, isCut: false }
  const end = text.lastIndexOf(unit, limit - 1)
  return { text: text.slice(0, end > 0 ? end + 1 : limit), isCut: true }
}

// `text` in a fenced code block whose fence is longer than any run of backticks inside it.
export function fenced(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n${text.replace(/\n$/, '')}\n${fence}`
}

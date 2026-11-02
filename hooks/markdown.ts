// Preparing Markdown for the pane: links it answers, front matter, and a cut to what one
// drawing takes. Pure.

import { normalize } from './paths'

// The file: href and path of a relative link target that names a Markdown file, resolved from
// `dir`, or undefined for any other target (a URL, an anchor, a root path, another file).
function markdownTarget(target: string, dir: string): { href: string; path: string } | undefined {
  const written = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
  if (/^[a-z][a-z0-9+.-]*:/i.test(written) || written.startsWith('#') || written.startsWith('/')) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(written.replace(/#.*$/, ''))
  } catch {
    return undefined
  }
  if (!/\.(md|markdown)$/i.test(decoded)) return undefined
  const path = normalize(`${dir}/${decoded}`)
  return { href: `file://${encodeURI(path)}`, path }
}

// Relative links to Markdown files (inline, in angle brackets, or by a reference definition)
// turned into file: links the pane answers, resolved from `dir`; links in code, images and
// other targets left as written. Returns the text and each new link's path by its href.
export function linkify(markdown: string, dir: string): { text: string; links: Map<string, string> } {
  const links = new Map<string, string>()
  const answer = (target: string) => {
    const found = markdownTarget(target, dir)
    if (found) links.set(found.href, found.path)
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

// YAML front matter at the top drawn as a YAML code block rather than a rule and a paragraph.
export function frontMatter(markdown: string): string {
  const found = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown)
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

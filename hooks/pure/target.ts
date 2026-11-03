// What a /peek argument asks for. Pure.

export type Target =
  | { kind: 'empty' }
  | { kind: 'command'; command: string }
  | { kind: 'git' }
  | { kind: 'path'; path: string; lines?: [number, number] }

// `!command` runs a command, `git` shows Git, anything else is a path or part of a name, which
// may start with @ and end in `:12` or `:12-14` for the lines to open at.
export function parseTarget(arg: string): Target {
  const text = arg.trim()
  if (text.startsWith('!')) {
    const command = text.slice(1).trim()
    return command ? { kind: 'command', command } : { kind: 'empty' }
  }
  if (text === '') return { kind: 'empty' }
  if (text === 'git') return { kind: 'git' }
  return { kind: 'path', ...splitLines(unmention(text)) }
}

// A path as typed, without the @ (and the quotes around a path with spaces, `@"a b.md"`) that
// Claude Code's @ completion puts in front; a bare @ stays, as a name to look for.
export function unmention(arg: string): string {
  const text = arg.trim()
  const quoted = /^@"([^"]+)"(.*)$/.exec(text)
  if (quoted) return `${quoted[1]}${quoted[2]}`
  return text.length > 1 && text.startsWith('@') ? text.slice(1) : text
}

// A path and the lines after it, `:12` or `:12-14`, in order; a line 0 is part of the path.
export function splitLines(text: string): { path: string; lines?: [number, number] } {
  const at = /^(.+?):(\d+)(?:-(\d+))?$/.exec(text)
  const from = Number(at?.[2])
  const to = Number(at?.[3] ?? at?.[2])
  if (!at?.[1] || from < 1 || to < 1) return { path: text }
  return { path: at[1], lines: [Math.min(from, to), Math.max(from, to)] }
}

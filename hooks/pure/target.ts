// What a /peek argument asks for. Pure.

export type Target =
  | { kind: 'empty' }
  | { kind: 'command'; command: string }
  | { kind: 'git' }
  | { kind: 'path'; path: string; lines?: [number, number] }

// `!command` runs a command, `git` shows Git, anything else is a path or part of a name, which
// may end in `:12` or `:12-14` for the lines to open at.
export function parseTarget(arg: string): Target {
  const text = arg.trim()
  if (text.startsWith('!')) {
    const command = text.slice(1).trim()
    return command ? { kind: 'command', command } : { kind: 'empty' }
  }
  if (text === '') return { kind: 'empty' }
  if (text === 'git') return { kind: 'git' }
  const at = /^(.+?):(\d+)(?:-(\d+))?$/.exec(text)
  const from = Number(at?.[2])
  const to = Number(at?.[3] ?? at?.[2])
  if (!at?.[1] || from < 1 || to < 1) return { kind: 'path', path: text }
  return { kind: 'path', path: at[1], lines: [Math.min(from, to), Math.max(from, to)] }
}

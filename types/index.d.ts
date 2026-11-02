// A file by its absolute path and the label shown for it: relative to the working directory
// inside it, from the home with ~/ elsewhere.
export type MdFile = { path: string; label: string }

// What the pane can show, one view at a time.
export type ViewName = 'file' | 'tree' | 'git' | 'command'

// A place in a view, which Back returns to.
export type Location =
  | { view: 'file'; path: string; lines?: [number, number] }
  | { view: 'tree'; root: string }
  | { view: 'git'; commit?: string }
  | { view: 'command' }

// The pane: whether it is open, the view it shows, and the places a link or a click was
// followed from, the last one last.
export type Nav = { isOpen: boolean; view: ViewName | null; back: Location[] }

// How the file view draws the file: rendered (Markdown only), as written with line numbers, or
// the changes since the person's last message.
export type FileMode = 'rendered' | 'source' | 'changes'

// The file the file view shows: the text last read and its modification time then, the text as
// it stood at the person's last message (what the changes view compares with), whether the file
// has since gone from the disk, the mode, and the lines it was opened at.
export type FileDoc = MdFile & {
  text: string
  mtimeMs: number
  base: string
  isDeleted: boolean
  isMarkdown: boolean
  mode: FileMode
  lines?: [number, number]
}

// The last command the command view ran: where, what it printed, and how it ended (its exit
// code, or the seconds after which it was stopped).
export type CommandRun = {
  command: string
  cwd: string
  cwdLabel: string
  stdout: string
  stderr: string
  exitCode: number | null
  stoppedAfter?: number
}

declare module 'claude-code' {
  interface PluginState {
    peek: {
      nav: Shaped<Nav>
      file: Shaped<FileDoc | null>
      command: Shaped<CommandRun | null>
      // The .md the last reply named, offered in the band until opened or dismissed.
      offer: Shaped<MdFile | null>
    }
  }
}

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

// The folder the tree view shows: its path, how it is labelled (the header, from the home; the
// heading of a quote and a mention, from the working directory; the name atop the tree), its
// branch in a repository, the folders opened and shown whole, the folder chosen, each opened
// folder's entries, Git's marks and what git ignores.
export type TreeState = {
  root: string
  label: string
  heading: string
  name: string
  branch?: string
  expanded: string[]
  full: string[]
  selected: string
  listings: Record<string, { name: string; kind: 'file' | 'dir' | 'other' }[]>
  badges: Record<string, string>
  ignored: string[]
}

// The Git view: the repository's top folder and how it is labelled, its status (branch, upstream,
// stash, the files staged, not staged and untracked), the history's lines, and the commit opened
// from the history with its details and its diff by file.
export type GitState = {
  root: string
  label: string
  status: {
    branch: string | null
    oid: string | null
    upstream?: string
    ahead: number
    behind: number
    stash: number
    staged: { path: string; mark: string }[]
    unstaged: { path: string; mark: string }[]
    untracked: string[]
  }
  log: { graph: string; commit?: { hash: string; refs: string; subject: string; age: string } }[]
  commit?: {
    hash: string
    author: string
    date: string
    subject: string
    body: string
    stat: string
    files: { path: string; hunks: string; note: string }[]
  }
}

declare module 'claude-code' {
  interface PluginState {
    peek: {
      nav: Shaped<Nav>
      file: Shaped<FileDoc | null>
      command: Shaped<CommandRun | null>
      tree: Shaped<TreeState | null>
      git: Shaped<GitState | null>
      // The .md the last reply named, offered in the band until opened or dismissed.
      offer: Shaped<MdFile | null>
    }
  }
}

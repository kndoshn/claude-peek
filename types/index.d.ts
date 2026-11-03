// A file by its absolute path and the label shown for it: relative to the working directory
// inside it, from the home with ~/ elsewhere.
export type MdFile = { path: string; label: string }

// What the band offers to open: a .md a reply named, or a file at the lines a reply cited.
export type Offer = MdFile & { lines?: [number, number] }

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
// Whether the pane is open, the view it shows, where Back returns, and whether another tab is
// shown in front of it.
export type Nav = { isOpen: boolean; view: ViewName | null; back: Location[]; isBehind?: boolean }

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
// code, or the seconds after which it was stopped), with the whole seconds it took from one up;
// while it runs again, what it printed the time before.
export type CommandRun = {
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
  stoppedAfter?: number
  seconds?: number
  isRunning?: boolean
}

// An entry of a folder as the tree lists it: a symbolic link as what it leads to (other when it
// leads nowhere), marked as a link.
export type TreeEntry = { name: string; kind: 'file' | 'dir' | 'other'; isLink?: boolean }

// The folder the tree view shows: its path, how it is labelled (the header, from the home; the
// heading of a quote and a mention, from the working directory; the name atop the tree), its
// branch in a repository, the folders opened and shown whole, the folder chosen, each opened
// folder's entries by its path from the root ('' for the root), Git's marks and what git
// ignores.
export type TreeState = {
  root: string
  label: string
  heading: string
  name: string
  branch?: string
  expanded: string[]
  full: string[]
  selected: string
  listings: Record<string, TreeEntry[]>
  badges: Record<string, string>
  ignored: string[]
}

// A file in Git's status and its mark.
export type GitFile = { path: string; mark: string }

// Git's status: the branch (null when detached), its commit (null before the first), the
// upstream and how far ahead and behind, the stash count, and the files staged, changed but not
// staged (conflicts marked U), and untracked.
export type GitStatus = {
  branch: string | null
  oid: string | null
  upstream?: string
  ahead: number
  behind: number
  stash: number
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: string[]
}

// A line of the graph history: the graph, then the commit when the line has one.
export type LogLine = { graph: string; commit?: { hash: string; refs: string; subject: string; age: string } }

// A file a commit changed: its path and its hunks, or what git says in their place (a binary
// file, a mode change).
export type PatchFile = { path: string; hunks: string; note: string }

// A commit opened from the history: its details, its changes by file in numbers, and its diff by
// file.
export type CommitDetails = {
  hash: string
  author: string
  date: string
  subject: string
  body: string
  stat: string
  files: PatchFile[]
}

// The Git view: the repository's top folder and how it is labelled, its status, the history's
// lines, and the commit opened from the history.
export type GitState = {
  root: string
  label: string
  status: GitStatus
  log: LogLine[]
  commit?: CommitDetails
}

declare module 'claude-code' {
  interface PluginState {
    peek: {
      nav: Shaped<Nav>
      file: Shaped<FileDoc | null>
      command: Shaped<CommandRun | null>
      tree: Shaped<TreeState | null>
      git: Shaped<GitState | null>
      // What the last reply pointed at, offered in the band until opened or dismissed.
      offer: Shaped<Offer | null>
    }
  }
}

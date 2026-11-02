// A Markdown file by its absolute path and the label shown for it: relative to the working
// directory inside it, from the home with ~/ elsewhere.
export type MdFile = { path: string; label: string }
// How the pane draws the file: rendered, as written with line numbers, or the changes since
// the person's last message.
export type View = 'rendered' | 'source' | 'changes'
// The file the pane shows, kept as one value so that each step (open, follow a link, go back,
// a change on disk) redraws once: the text last read and its modification time then, the text
// as it stood at the person's last message (what the changes view compares with), whether the
// file has since gone from the disk, the view, and the files a link was followed from, the
// last one last.
export type Doc = MdFile & {
  text: string
  mtimeMs: number
  base: string
  isDeleted: boolean
  view: View
  back: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'md-review': {
      doc: Shaped<Doc | null>
      // The file the last reply named, offered in the band until opened or dismissed.
      offer: Shaped<MdFile | null>
    }
  }
}

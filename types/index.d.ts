// A Markdown file by its absolute path and the label shown for it: relative to the working
// directory inside it, from the home with ~/ elsewhere.
export type MdFile = { path: string; label: string }
// The file the pane shows: the text last read from it and its modification time then, the text
// as it stood at the person's last message (what the changes view compares with), and whether
// the file has since gone from the disk.
export type Doc = MdFile & { text: string; mtimeMs: number; base: string; isDeleted: boolean }
// How the pane draws the file: rendered, as written with line numbers, or the changes since
// the person's last message.
export type View = 'rendered' | 'source' | 'changes'

declare module 'claude-code' {
  interface PluginState {
    'md-review': {
      doc: Shaped<Doc | null>
      view: Shaped<View>
      // The files a link was followed from, the last one last.
      back: Shaped<string[]>
      // The file the last reply named, offered in the band until opened or dismissed.
      offer: Shaped<MdFile | null>
    }
  }
}

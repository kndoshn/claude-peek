// A Markdown file by its absolute path and the label shown for it: relative to the working
// directory inside it, from the home with ~/ elsewhere.
export type MdFile = { path: string; label: string }
// The file the pane shows, with the text last read from it and its modification time then.
export type Doc = MdFile & { text: string; mtimeMs: number }

declare module 'claude-code' {
  interface PluginState {
    'md-review': {
      doc: Shaped<Doc | null>
      // The file the last reply named, offered in the band until opened or dismissed.
      offer: Shaped<MdFile | null>
    }
  }
}

# md-review

A Claude Code mod for reviewing the Markdown files Claude writes, without leaving the session.
`/md` opens a file rendered in a pane beside the chat; select a passage with the mouse and press
**Quote selection** to put it into your prompt as a quote headed by the file and its line
numbers. No other tab, editor or browser.

[日本語](README.ja.md)

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install md-review --marketplace kndoshn/md-review
```

Answer `y` to add the marketplace, then choose a scope (the user scope comes first).

From a shell:

```
claude plugin install md-review --marketplace kndoshn/md-review
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `kndoshn/md-review`, then Add plugin.

md-review is a hooks module (a mod) and needs a Claude Code build that loads them; it is tested
with Claude Code 2.1.316. Quoting reads the mouse selection, which Claude Code reports in the
fullscreen terminal. The pane docks beside the transcript from 110 columns, 100 columns wide (at
most 45% of the terminal; a width you drag it to wins), and below that sits above the prompt, as
tall as the file up to what the screen spares. In a dark theme it takes the terminal's background, as
the transcript does, so light text stays readable in the ANSI themes too.

## Use

| You do | md-review |
| --- | --- |
| `/md` | opens the newest `.md` Claude wrote, edited, read or named in the recent conversation |
| `/md docs/plan.md` | opens that file: relative to the working directory, `~/...` or absolute |
| `/md plan` | opens the best match for part of a name: the conversation's files, then the project's |
| typing `/md pl` | completes to matching Markdown files |
| a reply names a `.md` | offers **Open docs/plan.md** above the prompt; **×** dismisses it |

The pane is headed by the file, its line count and the view. It checks the file every second
and redraws when it changed on disk, whether Claude, your editor or a script changed it; a file
deleted on disk stays shown, marked as deleted. A relative link to another Markdown file
(`[setup](../setup.md)`) opens that file in the pane when clicked. Front matter is drawn as a
YAML block. A file too long to draw is cut, and the header says so.

While a file is open, a row above the prompt has:

- **Quote selection**: appends the passage you selected in the pane to your draft:

  ```
  docs/plan.md:12-14
  > The first step.
  >
  > - see the setup guide
  ```

  The line numbers come from finding the selected text in the file's source, or from the line
  numbers of the source view when the selection carries them. When the text cannot be found (a
  passage drawn from an image's alt text, say), the quote is headed by the file alone.
- **Source** / **Rendered**: switches between the rendered file and the file as written, with
  line numbers.
- **Changes +3 −1**: shows what changed in the file since your last message, as a diff. It
  appears once the file changed; your next message starts the count again. **Hide changes**
  returns to the file. Past about 1000 changed lines, the changed part is shown as replaced
  whole.
- **← Back**: returns to the file you followed a link from.
- **Close**: closes the pane. So do the pane's close mark, and Esc while the pane has the focus or
  the prompt is empty and Claude is idle.

Click a button, or focus the row (ctrl+x tab, or a click) and press its letter: `q` quote, `s`
source, `d` changes, `b` back, `o` open the offered file.

Only `.md` and `.markdown` files open. The project's files are those `git ls-files` lists
(tracked and untracked, not ignored); outside a git repository, those `fd` lists, if it is
installed.

## Settings

`/config` has one row for md-review:

| Setting | Values | Default |
| --- | --- | --- |
| Language | `auto`, `en`, `ja` | `auto`: Claude Code's `language` setting, then the locale (`LC_ALL`, `LC_MESSAGES`, `LANG`), then English |

## Develop

```
claude --plugin-dir .            # run a session with this folder loaded; saving a file reloads it
claude plugin test .             # run tests/*.test.tsx against the engine
claude plugin validate .         # check the manifest and the hooks module
```

| File | What it holds |
| --- | --- |
| `hooks/register.tsx` | the hooks module: wires the events to the rest |
| `hooks/doc.ts` | the shown file and the offer: their state and each step that changes them |
| `hooks/files.ts` | finding Markdown files and reading them |
| `hooks/ui.tsx` | the pane and the band |
| `hooks/messages.ts` | the messages in English and Japanese, and which language to use |
| `hooks/paths.ts`, `quote.ts`, `markdown.ts`, `diff.ts` | pure functions: paths, quoting, preparing Markdown, line diffs |
| `tests/md-review.test.tsx` | the mod against the engine |
| `tests/units.test.ts` | the pure functions |

## License

MIT

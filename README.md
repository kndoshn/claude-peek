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
fullscreen terminal. The pane docks beside the transcript from 110 columns and sits above the
prompt below that.

## Use

| You do | md-review |
| --- | --- |
| `/md` | opens the newest `.md` Claude wrote, edited, read or named in the recent conversation |
| `/md docs/plan.md` | opens that file: relative to the working directory, `~/...` or absolute |
| `/md plan` | opens the best match for part of a name: the conversation's files, then the project's |
| typing `/md pl` | completes to matching Markdown files |
| a reply names a `.md` | offers **Open docs/plan.md** above the prompt; **×** dismisses it |

While a file is open, a row above the prompt has:

- **Quote selection**: appends the passage you selected in the pane to your draft:

  ```
  docs/plan.md:12-14
  > The first step.
  >
  > - see the setup guide
  ```

  The line numbers come from finding the selected text in the file's source. When it cannot be
  found (a passage drawn from an image's alt text, say), the quote is headed by the file alone.
- **Reload**: reads the file again. md-review also checks the file every second and redraws the
  pane when it changed on disk, whether Claude, your editor or a script changed it.
- **Close**: closes the pane. So do Esc and the pane's close mark.

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

The hooks module is `hooks/register.tsx`; pure helpers are in `hooks/text.ts` and the messages in
`hooks/messages.ts`.

## License

MIT

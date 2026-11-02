# claude-peek

An unofficial Claude Code mod for looking at things beside the chat and handing Claude only the
part you need. `/peek` opens a file, a folder's tree, Git's status and history, or a command's
output in a pane beside the conversation; select a passage with the
mouse and press **Quote selection** to put it into your prompt, headed by where it came from
(`src/a.ts:118-125`). What you look at stays out of the conversation: only what you quote
reaches Claude. No other tab, editor or browser.

[日本語](README.ja.md)

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install peek --marketplace kndoshn/claude-peek
```

Answer `y` to add the marketplace, then choose a scope (the user scope comes first).

From a shell:

```
claude plugin install peek --marketplace kndoshn/claude-peek
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `kndoshn/claude-peek`, then Add plugin.

peek is a hooks module (a mod) and needs a Claude Code build that loads them; it is tested with
Claude Code 2.1.316. Quoting reads the mouse selection, which Claude Code reports in the
fullscreen terminal. The pane docks beside the transcript from 110 columns, 100 columns wide (at
most 45% of the terminal; a width you drag it to wins), and below that sits above the prompt, as
tall as its content up to what the screen spares. In a dark theme it takes the terminal's
background, as the transcript does, so light text stays readable in the ANSI themes too.

## Use

| You type | peek |
| --- | --- |
| `/peek src/a.ts` | opens the file: relative to the working directory, `~/...` or absolute |
| `/peek src/a.ts:120` or `:120-130` | opens the source at those lines, marked, scrolled to them |
| `/peek docs` | shows the folder's tree |
| `/peek reg` | opens the best match for part of a name: the files the conversation named, the project's files and folders, then the repositories of ghq |
| `/peek git` | shows the repository's status and history |
| `/peek !ls -la` | runs the command in your shell and shows its output |
| `/peek` | opens the pane again where it was; the first time, the working directory's tree |
| `/md [path or name]` | the same for Markdown only; without a name, the newest `.md` Claude named |
| typing `/peek re` | completes to matching files, folders and repositories, with the folder they are in beside them |
| typing `/peek !g` | completes to the commands you ran before that start so |
| a reply names a `.md` | offers **Open docs/plan.md** above the prompt; **×** dismisses it |

Markdown is rendered; any other text file shows as source with line numbers, coloured by its
language. Binary files and files over 4 MiB do not open. The pane is headed by the file, its line
count and the view; a file too long to draw is cut, and the header says so. The pane checks the
file every second and redraws when it changed on disk, whether Claude, your editor or a script
changed it; a file deleted on disk stays shown, marked as deleted. A relative link to another
Markdown file (`[setup](../setup.md)`, `[setup][ref]`, `[a](<my notes.md>)`) opens that file in
the pane when clicked. Front matter is drawn as a YAML block.

A folder shows as a tree, headed by its path and, in a git repository, its branch. Its smaller
folders open at first, up to 200 rows; click a folder to open or close it, and a file to open it
in the file view (**← Back** returns to the tree). A folder of more than 100 entries shows the
first 100 and a row that shows the rest. Files changed in git are marked `M`, `A`, `D`, `R` or
`?` (untracked), and folders that hold them `•`; what git ignores is dimmed and stays closed at
first. `.git` is left out. The tree is read again every 5 seconds while shown, and when Claude
runs a command or edits a file.

`/peek git` shows the repository the working directory is in: its branch with how far it is
ahead of and behind its upstream, the stash, the files staged, not staged and untracked (click one
to open it), and the history as `git log --graph` draws it, 40 commits. Click a commit to see its
author, date, message, files changed and diff by file (a merge's against its first parent);
**← Back** returns to the history. Diffs of the work in progress are left to Claude Code's own
`/diff`. git runs without taking the index lock (`GIT_OPTIONAL_LOCKS=0`), so it does not get in
the way of a git command of Claude's. While shown, its status is checked every 5 seconds, and
the rest is read again when the status moved or Claude ran a command or edited a file.

`/peek !command` runs the command in your shell (`$SHELL`, else `/bin/sh`) as an interactive
shell would, in the working directory, so your aliases and functions work. Its output shows in
the pane and stays out of the conversation, unlike `!` mode; quote only the lines you need. The
pane is headed by the command and its exit code; standard error shows apart; colours and other
escape sequences are removed. A command is stopped after 30 seconds (see Settings); one that
never ends, such as `tail -f`, is not for this view. Like `!` mode, the command runs outside
Claude's sandbox. peek sets `PEEK=1` for it, so a shell startup file that turns aliases off
inside Claude Code (by testing `CLAUDECODE`) can keep them for these commands:
`if [[ -z "${CLAUDECODE:-}" || -n "${PEEK:-}" ]]`.

While the pane is open, a row above the prompt has:

- **File** · **Tree** · **Git** · **Command**: switches the view; a view keeps what it showed. One never opened says
  how to open it.

- **Quote selection**: appends the passage you selected in the pane to your draft:

  ```
  docs/plan.md:12-14
  > The first step.
  >
  > - see the setup guide
  ```

  The line numbers come from finding the selected text in the file's source, or from the line
  numbers of the source view when the selection carries them. When the text cannot be found (a
  passage drawn from an image's alt text, say), the quote is headed by the file alone. A passage
  selected in the conversation is quoted without a heading.
- **Source** / **Rendered** (Markdown): switches between the rendered file and the file as
  written, with line numbers.
- **Changes +3 −1**: shows what changed in the file since your last message, as a diff. It
  appears once the file changed; your next message starts the count again. **Hide changes**
  returns to the file. Past about 1000 changed lines, the changed part is shown as replaced
  whole.
- **@ path**: appends the file as an `@` mention, so Claude reads it.
- **Quote tree** (tree): appends the tree as `tree` prints it, under the folder, in a code block.
  **@ path** mentions the folder you last clicked (else the one shown); **Copy** puts the tree on
  the clipboard.
- **Commit to prompt** (a commit opened in Git): appends its hash and subject. **Refresh** reads
  Git again at once.
- **Quote output** (command): appends the whole output under the command, in a code block.
- **Run again** (command): runs the command anew, in the folder it ran in.
- **Copy** (command): puts the output on the clipboard.
- **← Back**: returns to the file you followed a link from.
- **Close**: closes the pane. So do the pane's close mark, and Esc while the pane has the focus or
  the prompt is empty and Claude is idle.

Click a button, or focus the row (ctrl+x tab, or a click) and press its letter: `q` quote, `s`
source, `d` changes, `a` @ path, `t` quote tree or output, `r` run again or refresh, `c` copy, `b` back, `o` open
the offered file.

The project's files are those `git ls-files` lists (tracked and untracked, not ignored); outside
a git repository, those `fd` lists, if it is installed. Repositories come from `ghq list`, if ghq
is installed.

## Settings

`/config` has three rows for peek:

| Setting | Values | Default |
| --- | --- | --- |
| Language | `auto`, `en`, `ja` | `auto`: Claude Code's `language` setting, then the locale (`LC_ALL`, `LC_MESSAGES`, `LANG`), then English |
| Command time limit (seconds) | 1 to 600 | 30 |
| Short commands /tree and /git | on, off | off: these names may be other plugins' or skills'; on, `/tree [folder]` and `/git` do what `/peek [folder]` and `/peek git` do |

## Develop

The design is in [docs/design.md](docs/design.md), written in Japanese.

```
claude --plugin-dir .            # run a session with this folder loaded; saving a file reloads it
claude plugin test .             # run tests/*.test.ts(x) against the engine
claude plugin validate .         # check the manifest and the hooks module
```

| File | What it holds |
| --- | --- |
| `hooks/register.tsx` | the hooks module: the commands, and the events wired to the rest |
| `hooks/nav.ts` | the pane: whether it is open, the view it shows, and Back across views |
| `hooks/views/*.ts` | each view's state and the steps that change it |
| `hooks/ui/*.tsx` | the pane, the band, and each view's drawing |
| `hooks/find.ts` | finding files and reading them |
| `hooks/prompt.ts` | quoting and mentioning into the prompt |
| `hooks/run.ts` | running git without the index lock, the clock, and when a view is read again |
| `hooks/messages.ts` | the messages in English and Japanese, and which language to use |
| `hooks/pure/*.ts` | pure functions: paths, targets, quoting, Markdown, line diffs, terminal output, trees, git's output |
| `tests/*.test.tsx` | the mod against the engine; `tests/support.tsx` is the engine beneath |
| `tests/units.test.ts` | the pure functions |

## License

MIT

# claude-peek

Peek at files, folders, Git and command output beside the chat in Claude Code, and quote just the
part you need into your prompt, with where it came from.

[日本語](README.ja.md)

`/peek` opens a pane beside the conversation. Select a passage with the mouse, press **Quote
selection**, and it lands in your prompt like this:

```
src/parser.ts:118-120
> const end = text.lastIndexOf('\n')
> if (end < 0) return text
> return text.slice(0, end)
```

What you look at stays out of the conversation: only what you quote reaches Claude. No other tab,
editor or browser. peek is an unofficial Claude Code mod.

| View | Open it with | What it shows |
| --- | --- | --- |
| File | `/peek src/a.ts`, `/md plan` | Markdown rendered, any other text as numbered source, and what changed since your last message |
| Tree | `/peek docs` | a folder as a tree with git's marks; click to open folders and files |
| Git | `/peek git` | the branch, the status and the history graph; click a commit for its diff |
| Command | `/peek !ls -la` | the output of a command run in your own shell |

## Requirements

- Claude Code with hooks modules (mods). peek is tested with Claude Code 2.1.316.
- The fullscreen terminal, for quoting: it reads the mouse selection, which Claude Code reports
  there.
- Optional: git (marks, the Git view, the project's files), ghq (repositories to open), fd (the
  files outside a git repository). Without them peek leaves out what they would add.

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

## Usage

### Commands

| You type | peek |
| --- | --- |
| `/peek src/a.ts` | opens the file: relative to the working directory, `~/...` or absolute |
| `/peek src/a.ts:120` or `:120-130` | opens the source at those lines, marked and scrolled to |
| `/peek docs` | shows the folder's tree; `/peek ~` the home's |
| `/peek reg` | opens the best match that holds what you typed in its name or path (see below) |
| `/peek git` | shows the repository's status and history |
| `/peek !ls -la` | runs the command in your shell and shows its output |
| `/peek` | opens the pane again where it was; the first time, the working directory's tree |
| `/md [path or name]` | the same for Markdown only; without a name, the newest `.md` Claude named |

A name looks through the files the conversation named, then the project's files and folders, then
the repositories of ghq. The project's files are those `git ls-files` lists (tracked and untracked,
not ignored), or outside a git repository those `fd` lists. A name opens only a match that holds it
as typed; a looser match, its letters only in order, is offered as a completion instead.

When a reply cites lines, as in `hooks/find.ts:89`, `/peek` offers the file at those lines, and a
name whose best match is one opens there. Lines you type win, and a whole path opens at the top.
`/md` offers Markdown without lines, as it is for reading rendered.

While you type, `/peek re` completes to matching files, folders and repositories, with the folder
each is in beside it, and `/peek !g` to the commands you ran before that start so. When a reply
names a `.md` file or cites lines of a file, the row above the prompt offers **Open docs/plan.md**
or **Open src/a.ts:118-120**, which opens it at those lines; **×** dismisses it.

### File view

- Markdown is rendered; any other text file shows as source with line numbers, coloured by its
  language. **Source** switches Markdown to the file as written.
- The header names the file, its line count and the view. A file too long to draw is cut, and the
  header says so. Binary files and files over 4 MiB do not open.
- The file is checked every second and redrawn when it changes on disk, whoever changed it. A file
  deleted on disk stays shown, marked as deleted; one that turns binary or grows past 4 MiB keeps
  what was shown. Coming back to it from the band or `/peek` shows the same.
- **Changes +3 −1** shows what changed since your last message, as a diff. It appears once the
  file changed, and your next message starts the count again. Past about 1000 changed lines, the
  changed part shows as replaced whole.
- A relative link to a file or folder (`[setup](../setup.md)`, `[setup][ref]`, `[a](<my notes.md>)`,
  `[parser](../src/a.ts#L10-L20)`, `[src](../src/)`) opens it in the pane: a file in the file view,
  at the lines of a GitHub anchor (`#L10`, `#L10-L20`) if it has one, a folder in the tree.
  **← Back** returns.
- Front matter shows as a YAML block, also after a byte order mark or with CRLF line endings.
- A control character shows as its picture (`␛` for an escape, `␌` for a page break), so a log with
  colours still opens. The same goes for names and for what git prints.

### Tree view

- The header shows the folder's path and, in a git repository, its branch.
- The smaller folders open at first, up to 200 rows. Click a folder to open or close it, and a file
  to open it in the file view (**← Back** returns to the tree).
- A folder of more than 100 entries shows the first 100 and a row that shows the rest.
- Files changed in git are marked `M`, `A`, `D`, `R` or `?` (untracked), and the folders that hold
  them `•`. What git ignores is dimmed and stays closed at first. `.git` is left out.
- A symbolic link shows as what it leads to; a linked folder opens when clicked, not at first.
- While shown, git's status and the open folders are checked every 5 seconds, and the tree is read
  again when either moved or Claude ran a command or edited a file.

### Git view

- `/peek git` shows the repository the working directory is in: the branch with how far it is
  ahead of and behind its upstream, the stash, and the files staged, not staged and untracked.
  Click a file to open it; a folder opens in the tree.
- The history is drawn as `git log --graph` draws it, 40 commits. Click a commit to see its author,
  date, message, files changed and diff by file (a merge's against its first parent).
- Diffs of the work in progress are left to Claude Code's own `/diff`.
- File names that are not ASCII read as written (`core.quotePath=false`). git runs without taking
  the index lock (`GIT_OPTIONAL_LOCKS=0`), so it does not get in the way of Claude's git.
- While shown, the status is checked every 5 seconds, and the rest is read again when the status
  moved or Claude ran a command or edited a file.

### Command view

- `/peek !command` runs the command in your shell (`$SHELL`, else `/bin/sh`) as an interactive
  shell would, in the working directory, so your aliases and functions work.
- The output shows in the pane and stays out of the conversation, unlike `!` mode; quote only the
  lines you need.
- The pane opens as the command starts, its header saying it is running. Once it ended, the header
  shows the exit code and, from a second up, how long it took. Standard error shows apart. Colours
  and other escape sequences are removed.
- A command is stopped after 30 seconds (see [Settings](#settings)); one that never ends, such as
  `tail -f`, is not for this view.
- Like `!` mode, the command runs outside Claude's sandbox.
- peek sets `PEEK=1` for the command. If your shell's startup file turns aliases off inside Claude
  Code by testing `CLAUDECODE`, test `PEEK` too to keep them here:
  `if [[ -z "${CLAUDECODE:-}" || -n "${PEEK:-}" ]]`.

### Buttons and keys

While the pane is open, a row above the prompt holds the buttons of the view shown. Click one, or
focus the row (ctrl+x tab, or a click) and press its key.

| Button | Shown | Key | What it does |
| --- | --- | --- | --- |
| **File** · **Tree** · **Git** · **Command** | always | | switches the view; each keeps what it showed. Tree and Git open at the working directory the first time; File and Command say how to open them |
| **Quote selection** | always | `q` | appends the passage selected in the pane to your draft, headed by where it came from |
| **Source** / **Rendered** | Markdown | `s` | switches between the rendered file and the numbered source |
| **Changes +3 −1** / **Hide changes** | a changed file | `d` | shows or hides what changed since your last message |
| **@ path** | file, tree | `a` | appends the file, or the folder last clicked, as an `@` mention, so Claude reads it |
| **Quote tree** | tree | `t` | appends the tree as `tree` prints it, under the folder, in a code block |
| **Commit to prompt** | an open commit | `a` | appends the commit's hash and subject |
| **Refresh** | Git | `r` | reads Git again at once |
| **Quote output** | command | `t` | appends the whole output under the command, in a code block |
| **Run again** | command | `r` | runs the command anew, in the folder it ran in, keeping the output shown until it ends |
| **Copy** | tree, command | `c` | puts the tree or the output on the clipboard |
| **← Back** | after a link or a click | `b` | returns to where you came from |
| **Close** | always | | closes the pane |
| **Open docs/plan.md** | a reply named a `.md` or cited lines | `o` | opens the file it offers, at the lines cited |

A quote's line numbers come from finding the selected text in the file, or from the numbers the
source view put into the selection. When the text cannot be found (an image's alt text, say), the
quote is headed by the file alone. A passage selected in the conversation is quoted without a
heading.

### The pane

- From 110 columns the pane docks beside the transcript, 100 columns wide (at most 45% of the
  terminal; a width you drag it to wins). Narrower, it sits above the prompt, as tall as its
  content up to what the screen spares.
- In a dark theme it takes the terminal's background, as the transcript does, so light text stays
  readable in the ANSI themes too.
- Behind another tab, such as `/diff`'s, it comes to the front when `/peek` or the band opens a view.
  Meanwhile the band holds only the views, **Quote selection** and **Close**.
- It closes with **Close**, its close mark, or Esc while it has the focus or the prompt is empty and
  Claude is idle. `/clear` and resuming another conversation close it too, as peek starts over in
  the next conversation.

## Settings

`/config` has three rows for peek:

| Setting | Values | Default |
| --- | --- | --- |
| Language | `auto`, `en`, `ja` | `auto`: Claude Code's `language` setting, then the locale (`LC_ALL`, `LC_MESSAGES`, `LANG`), then English |
| Command time limit (seconds) | 1 to 600 | 30 |
| Short commands /tree and /git | on, off | off, as other plugins or skills may use these names. On, `/tree [folder]` and `/git` do what `/peek [folder]` and `/peek git` do |

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

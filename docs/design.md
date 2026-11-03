# claude-peek design

A mod for Claude Code that lets you look at files, folders, Git and command output, and hand Claude
only the parts you need, each headed by where it came from. The repository is
`kndoshn/claude-peek`; the plugin is named `peek`. How to use it is in the [README](../README.md);
this document describes how it works and why.

[日本語](design.ja.md)

- [Purpose and principles](#purpose-and-principles)
- [Layout](#layout)
- [Commands](#commands)
- [The views](#the-views) (file, tree, Git, command)
- [Shared mechanisms](#shared-mechanisms) (quoting, Back, re-reading, language)
- [Settings and limits](#settings-and-limits) (settings, safety, limits)
- [Implementation](#implementation) (state, files)
- [Tests](#tests)
- [Out of scope](#out-of-scope)

## Purpose and principles

Handing Claude information used to mean running `la`, `tree`, `pwd`, `gs`, `gd`, `glo`, `glow` or
`cat` in another tab, then copying part of the output and pasting it. peek removes that step. Not
opening a tab also removes the accidents that come with tabs: leaving them open, or working in the
tab of another repository.

- **Look only**: peek does not write files or run Git operations (staging, committing and so on)
- **Keep what you look at out of the conversation**: only what the person quotes reaches Claude.
  Unlike `!` mode, looking uses no context
- **Head what is handed with where it came from**: a file's line numbers, or the command itself
- **Be brief to use**: Esc closes it at once, and opening it again returns to where it was
- **Use external commands when they are there**: what can work without git, ghq or fd still works

## Layout

### The pane

There is one pane (id `peek`), and the band above the prompt switches it between four views. A
pane per view would make Claude Code show its own tabs, but no event reports a switch between
those tabs, so the band's buttons could not follow the view at once. Each view keeps its state
(the open file, the folders open in the tree, the chosen commit, the last command) across switches.

- It opens with `columns: 100` and `closeOnEscape`. When it sits above the prompt, `rows` is set
  to the height of its content
- `rows` counts the header as one line, so the header is cut rather than wrapped. A path or a
  branch keeps its end, a commit its start (the hash and subject), a command its start and its end
- In a dark theme the background is `transparent`, showing the terminal's own. The engine's
  default background is bright black in the ANSI themes (#555555 in many palettes), on which light
  text is hard to read
- When a command, a view switch in the band or Back opens the pane while it is behind another tab
  (such as `/diff`'s), the pane comes to the front. `$.ui.open` on a pane behind only changes its
  title, which looks as if nothing happened
  - Opening with `focus: true` brings it to the front (the prompt keeps the keys)
  - Scrolling does not take right after it comes to the front, so opening at a line waits
    100 milliseconds before scrolling
  - When a command ends and the height is set again, the pane is not brought to the front, so as
    not to hide a tab the person brought forward meanwhile
- `/clear` and resuming another conversation (`session.end` with `reason` `clear` or `resume`)
  close the pane. In the next conversation peek's state (`$.state`) starts over (or becomes that
  conversation's, on a resume), but the engine leaves the pane open. Left open, its content would
  turn into a hint and the band would disappear, so the pane and the state would disagree

### The band

```
[File] Tree  Git  Command │ [Quote selection]  Source  Changes +3 −1  @ path  ← Back  Close
```

- The view switches sit on the left; on the right, the current view's actions, then **← Back**
  and **Close**, shared by all. The band wraps when it lacks width
- Pressing a view never opened yet opens it at its default target (the working directory for Tree
  and Git). File and Command have no default target, so they say how to open them
- A button's letter key works only while the band has the focus (ctrl+x tab, or a click), not from
  the prompt. No digits are used, as typing a digit in an empty prompt would press a band button
- While the pane is behind another tab, the band shows only the view switches, **Quote
  selection** and **Close**, since a button acting on the view would act on one that is not seen.
  A view switch brings the pane to the front, and the quote takes what was selected in that tab
  without a heading. Whether the pane is behind is read every second from `isShown` in
  `$.ui.panes()` and written to `nav`
- **Open** offers the `.md` that the replies since the last message touched last (read rendered,
  so without lines), or a file cited at its lines, as in `src/a.ts:12`. A code file or any other
  file named without lines is not offered: replies touch many file names along the way, and cite
  lines when they want a place looked at. Nothing is offered when the pane already shows that file
  at those lines
- The band shows only the current view's actions, so the same key serves different actions in
  different views (`a` is **@ path** in File and Tree, **Commit to prompt** in Git)

| View | Band actions | Keys |
| --- | --- | --- |
| All | **Quote selection** | `q` |
| File | **Source** / **Rendered** (for `.md`), **Changes +a −r** (once changed), **@ path** | `s`, `d`, `a` |
| Tree | **Quote tree**, **@ path**, **Copy** | `t`, `a`, `c` |
| Git | **Commit to prompt** (with a commit chosen), **Refresh** | `a`, `r` |
| Command | **Quote output**, **Run again**, **Copy** | `t`, `r`, `c` |
| All | **← Back** (when there is somewhere to go back to), **Close** | `b` |
| When a reply touched a `.md` or cited a file's lines | **Open** that file (at the lines, if cited), **×** | `o` |

## Commands

### `/peek [target]`

The argument picks the view, by the first rule that applies.

| Argument | View | Example |
| --- | --- | --- |
| none | opens the last view again; the first time, the working directory's tree | `/peek` |
| starts with `!` | Command | `/peek !glo -20` |
| `git` | Git | `/peek git` |
| an existing file (optionally ending in `:line` or `:line-line`) | File | `/peek src/a.ts:120`, `/peek ~/notes/x.md` |
| an existing folder | Tree | `/peek docs`, `/peek ~`, `/peek ~/repos/github.com/pentim/shok` |
| anything else | looks among the candidates for those whose name or path holds the text as typed, and opens the best match in its kind of view | `/peek plan`, `/peek shok` |

The candidates come in this order.

1. Files the conversation named (those Claude read, wrote or edited, and paths in the text of its
   replies). When the text cites lines, as in `hooks/find.ts:89`, the candidate for `/peek` keeps
   them. The same file cited at different lines gives a candidate for each
2. The project's files and folders (`git ls-files`, or fd outside git)
3. The repositories of ghq (`ghq list -p`; none without ghq)

`rank` narrows them (contained in the file name → contained in the path → loosely matching the
name → loosely matching the path), keeping the order above within a rank. A loose match (the typed
letters appearing only in order) is offered as a completion, but the command does not open it
(`closest`): with ghq's repositories included, most short words loosely match something, and that
is rarely what was looked for. When nothing matches, the command answers "not found" and how to
name a target.

When the best match is a candidate with lines, it opens at those lines, so that the first
completion and what Enter opens are the same. Lines typed (`/peek find:20`) win, and a path typed
whole opens at the top. `/md` offers candidates without lines: Markdown is mostly read rendered,
and opening at a line switches to the source.

### `/md [name]`

The way in for reading `.md` files. It differs from `/peek` in keeping only `.md` candidates and,
without an argument, opening the newest `.md` the conversation named.

### Completing the argument

Typing after `/peek ` or `/md ` offers these (10 at most).

- Starting with `!` (`/peek` only): the commands run recently (kept in `$.store` across sessions,
  20 at most)
- Otherwise: `git` (for `/peek`, when the text typed is a start of `git`) and the fuzzy candidates.
  Each row shows the name and the folder it is in

So as not to list again on every keystroke, the lists (the conversation's files, the project's
files, ghq's repositories) and the candidate strings made from them are reused for 5 seconds: in
a repository of 100,000 files, making the candidates alone takes tens of milliseconds. Opening
with the command lists again.

### Short aliases

`/tree [folder]` and `/git` are registered only when the setting `shortCommands` is on. A
published plugin that takes common names collides with other plugins and skills, so they are not
made by default.

## The views

### File

Any text file opens, not only `.md`.

**Drawing**

- `.md` and `.markdown` are rendered, and **Source** switches to the file as written, with line
  numbers. Any other file always shows as numbered source (the `Code` element gets `path` and
  picks the highlighting language from the extension)
- Front matter is drawn as a YAML block, also found after a leading BOM and with CRLF line endings
- Clicking a relative link to a file or folder opens it in the pane. On the click, `stat` tells the
  kind: a folder opens in the tree, a file in the file view. A GitHub line anchor (`#L10`,
  `#L10-L20`; a column `C3` is ignored) opens it at those lines. READMEs and design documents link
  to code and folders often, and this follows them as reading on GitHub does. URLs, anchors alone
  (`#...`), paths starting with `/`, images and links inside code stay as they are. Up to 256
  links per drawing are clickable; later ones show as text
- Binary files (holding a NUL) and files over 4 MiB (the read limit) do not open; the reason is
  shown. Beyond 90,000 characters nothing is drawn (one drawing takes at most 100,000). The limits
  are gathered under [Limits](#limits)

**Tracking changes**

- What changed since the last message shows as a diff (for files of any kind)
- Past 1,000 changed lines, the changed part shows as replaced whole, to bound the time and memory
  the diff takes
- Changes on disk are checked every second. A file deleted on disk stays shown, marked as deleted
  at the top
- A file that turns binary or grows past 4 MiB after it opened keeps showing what was last read,
  and is not read again until it changes again
- Coming back to such a file through the band's **File**, `/peek` or Back shows the same kept
  content rather than refusing it as unreadable

**Control characters**

Drawing accepts no control characters other than tab and newline; a single one leaves the whole
pane undrawn. So they are replaced when drawn:

- A control character becomes its picture (`␛` for ESC, `␌` for a form feed: the symbols at
  U+2400; the C1 range has none, so it becomes `�`). A CRLF line ending becomes a newline. Neither
  moves or adds a line
- The same replacement applies to paths, names in the tree and what Git prints (commit messages,
  diffs, paths in the status), not only file contents
- The strings held stay as they were; opening files and finding quoted lines use the originals

**Opening at a line**

Opened with `path:120` or `path:120-130`, the file shows as source, scrolled to put that line at
the top, marked by a background colour.

- The source is drawn as three `Code` elements (before, the lines, after), the middle one wrapped
  in a `Box` with a background colour (key `peek-line`). Without lines, a single `Code` is drawn
- Before the lines, at most 20,000 characters are drawn, cutting the head. Even a line far down a
  long file stays inside the drawing limit
- `$.ui.open` returns once the pane is drawn, and then `$.ui.scroll({ to: { key: 'peek-line' },
  in: 'peek', block: 'start' })` scrolls once (if refused, the pane stays open)
- The header names the line, as in "line 120"

**Quotes and @ path**

- A quote is headed `docs/plan.md:12-14`. In the rendered view the selected text is found in the
  file to tell the lines (`locate`); in the source view the line numbers in the selection are read
  (`ungutter`). When the lines cannot be told, the file name alone heads it
- **@ path** appends the shown file as `@path` to the prompt: relative inside the working
  directory, `~/` or absolute outside it

### Tree

Instead of `la`, `tree`, `pwd` and looking up the path of another repository.

**Listing**

- The header shows the root's absolute path and, in a Git repository, the branch (`branch.head`
  from `git status --porcelain=v2 --branch`; not shown on a detached HEAD)
- The listing comes from `$.fs.list` (no external command needed). Folders come first, then names
  in order, ignoring case. Hidden files show; only `.git` is left out
- A symbolic link shows as the kind it leads to (folder or file). A linked folder opens on a click
  but not at first, as it may point to a folder above
- At first the root opens, and the folders right under it as far as the rows add up to 200 at most.
  A folder of more than 100 entries shows the rest as one row, "…N more", which shows them all when
  pressed. The tree shows 1,000 rows at most

**Git's marks and what Git ignores**

- `git status --porcelain=v2 --branch -z` gives the marks (`M`, `A`, `D`, `R`, `?`) shown right of
  files, and a dot on folders that hold changes. The branch comes from the same output. Only the
  shown folder's status is read (`-- .`), and the difference from the upstream is not counted
  (`--no-ahead-behind`), as the tree does not show it
- What .gitignore covers is found with `git ls-files -z --others --ignored --exclude-standard
  --directory` and shows dimmed and closed. Even inside an ignored folder (`node_modules` and the
  like), the tree lets the person look and tell Claude
- With the root inside a folder Git ignores whole, Git answers `./`, so everything shows dimmed.
  The person chose that folder, so a small one opens at first
- Where the root sits in the repository is asked of Git (`git rev-parse --show-prefix`) and
  matched against the paths of `git status`. Comparing path strings would lose every mark on a path
  through a symbolic link (such as `/tmp` on macOS; Git answers with the real path)
- The three Git commands (`rev-parse`, `status`, `ls-files`) run side by side. All of them answer
  in a repository without commits too

**Actions**

- Each row is a button. A folder opens or closes and becomes the "selected" folder. A file opens in
  the file view (Back returns to the tree)
- **@ path** in the band appends the selected folder (or the root, when none is) as `@path`
- **Quote tree** appends the visible tree to the prompt as a code block headed `tree docs/`.
  **Copy** puts the same string on the clipboard with `$.ui.copy`
- The tree's string uses the same box drawing as `tree` (`├──`, `└──`, `│`) and includes the marks

**Re-reading** (the interval and what triggers a full read are under [Shared mechanisms](#re-reading))

- On the timer, only `git status` and the listings of the shown folders (the root and the open
  folders) are read, and everything is read again when either differs from the last time. What Git
  ignores changes only when a folder's contents change, which the listings notice
- Opening a folder reads everything on the next tick, to pick up what became ignored while it was
  closed

### Git

Instead of `gs` and `glo`. The diff of the work in progress is left to the built-in `/diff`.

**Screen**

- **Header**: the branch, its upstream and how far apart they are (`↑2 ↓0`), and the stash count,
  read from the `#` lines of `git status --porcelain=v2 --branch --show-stash -z`
- **Status**: files grouped as staged, not staged and untracked. Each row is a button that opens
  the file in the file view. A folder (a whole untracked folder, a link to a folder, a submodule)
  opens in the tree. A deleted file says it cannot be opened. At the end, dimmed: "See diffs with
  /diff"
- **History**: 40 commits of `git log --graph --format=%x1f%h%x1f%D%x1f%s%x1f%ar -n 40
  --color=never`. The graph lines are dimmed; the hash, the refs (branches and tags), the subject
  and the age are coloured apart. Each commit row is a button that shows the commit's details
- **Commit details**: the author, the date, the message, the files changed with their line counts
  (`git show --stat`) and the diff of each file. The diff comes from `git show --format= --patch
  --no-color --no-ext-diff --diff-merges=first-parent`, split by file, each drawn as a `Code`
  element in diff mode. A merge commit shows its diff against the first parent (`/diff` cannot
  show past commits, so this fills that gap)
- **Commit to prompt**: appends the chosen commit to the prompt as `abc1234 (subject)`
- Outside a repository the view says it is not a Git repository

**Running Git**

- Git runs with `GIT_OPTIONAL_LOCKS=0`, so that `git status` does not take the index lock and
  collide with the Git Claude runs at the same time
- `core.quotePath=false` is passed as well. By default Git quotes a path with non-ASCII characters
  (Japanese file names, say) and writes each byte in octal, which makes both the list of changed
  files and the diff headers unreadable. It goes through the environment (`GIT_CONFIG_COUNT`,
  `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`; Git 2.31 or later), keeping the arguments Git's own
- Even so, a path holding `"`, `\` or a control character is quoted and escaped, so the diff
  headers turn it back into the original path. Control characters become pictures when drawn, as
  for other strings (see the File section)
- The repository's root (`git rev-parse --show-toplevel`), the status, the history and the chosen
  commit's details are read side by side from the working directory: Git answers with paths from
  the root wherever in the repository it is asked

**Re-reading** (the interval and what triggers a full read are under [Shared mechanisms](#re-reading))

- On the timer only the status (`git status`) is read, and the history only when that output
  changed
- Opening the view and pressing **Refresh** read everything as well
- An open commit's details are not read again, as a commit's content does not change

### Command

Instead of the commands left over, those run in another tab that none of the views above covers.

**Running**

- `/peek !command` runs in the person's shell (`$SHELL`, else `/bin/sh`) in interactive mode
  (`-ic`), in the working directory. Interactive mode makes the aliases and functions defined in
  `.zshrc` and the like (`gs`, `glo`, `la` and so on) work
- The environment variable `PEEK=1` is set for the run. If the shell's startup file turns aliases
  off inside Claude Code (by testing `CLAUDECODE`), adding `PEEK` to that test keeps them working
  in peek alone
- Standard input is `/dev/null`, as when nothing is typed in a terminal. Given an empty pipe, a
  tool that takes a pipe as its input in place of the folder (`rg`, say) searches the pipe and
  finds nothing. The engine writes only text to a pipe, so `/bin/sh` points standard input at
  `/dev/null` and starts the shell (`exec "$0" -ic "$1" </dev/null`), for any shell
- The time limit is 30 seconds (the setting `commandTimeoutSeconds`).
  When the run is refused, the view says the command was stopped if the limit had passed, else
  that it could not run and why (without relying on the engine's wording of the refusal)
- Like `!` mode, it runs outside the agent's sandbox
- The pane opens as the run starts, its header saying "running…": opening it only at the end
  would look like nothing happened during a slow command. Once it ends, the pane's height is set
  again to the output's line count (when it sits above the prompt), unless another view was shown
  meanwhile
- While running again, the previous output stays with "running…" and is replaced at the end.
  Pressing again during a run does not run it. Starting another command during a run keeps the
  later command's output

**Output**

- ANSI escapes (colours and screen control) and control characters other than tab and newline are
  removed. In a line with `\r`, only what follows the last `\r` stays (reproducing progress output
  that overwrites itself). Only characters that can be drawn are kept
- Warnings a terminal-less interactive shell prints (such as `can't change option: zle`) are
  dropped. Others that turn up are added to the list dropped
- The header shows the command and its exit code (coloured when not 0), and how many seconds it
  took when that was a second or more, so a run again with the same output still shows it ran.
  Standard output is drawn in a `Code` element, and standard error, if any, apart below it

**History**

- The commands run are kept in `$.store`, 20 at most, and offered as completions. Commands that
  appear in Claude's replies are never run automatically

## Shared mechanisms

### Quoting

A selection is headed by where it came from and appended to the prompt as a quote, after the draft
and a blank line.

| Source | Heading |
| --- | --- |
| File | `docs/plan.md:12-14` (`docs/plan.md` when the lines are not known) |
| Tree | `tree docs/` |
| Git status / history / commit details | `git status` / `git log` / `git show abc1234` (`git show abc1234 -- src/a.ts` inside one file's diff) |
| Command | `$ ls -la` |

- When `$.ui.selection()` returns a `requestId`, the selection is in the conversation, and the
  quote has no heading
- A missing `requestId` happens not only for selections outside the conversation (in the pane) but
  also for a selection across several rows of the conversation. So its absence does not prove a
  pane selection, and matching strings decides
- The selection is looked for in the strings of the current view; when found, it is headed by its
  source. When not found, the file view heads it with the file name alone, and the other views
  give no heading
- In commit details, when the selection is found only inside one file's diff (including its file
  name line), the heading names that file too. Diff lines are short, and without the file Claude
  searches the commit again. A selection also found in the message or the line counts, one across
  files, or a line both files hold is headed by the commit alone. A path holding characters the
  shell cannot read as they are is put in single quotes, keeping the heading runnable as it is

### Back

One history runs across the views.

- Moving by a link or a click (tree to file, Git to file, a Markdown link, history to commit
  details) pushes the place left
- Opening with `/peek` or `/md` empties the history
- When the place to return to cannot be read, that entry is dropped and the view says so

### Re-reading

`session.start` runs a single one-second timer, which decides for each view:

| View | Interval | Condition |
| --- | --- | --- |
| File | 1 second | while a file is open; read only when its modification time changed |
| Tree | 5 seconds | while the pane is shown (`isShown` in `$.ui.panes()`) with the tree in it |
| Git | 5 seconds | the same, with Git in it |
| Command | none | only when **Run again** is pressed |

- On the timer, Tree and Git check with few reads whether anything moved (Git with `git status`,
  Tree with that and the listings of the shown folders), and read everything only when it did. In
  a large repository each Git command that reads the working tree takes time
- When Claude's turn ends, and after Claude runs a shell command or edits a file (Bash, Write,
  Edit, MultiEdit, NotebookEdit), Tree and Git are marked stale and read whole on the next tick
- A read does not start until the previous one ends, so reads never overlap. Reads that do not
  depend on each other (Git commands, folder listings) run side by side
- When a read gives what is already shown, nothing is written and the pane is not redrawn

### Language

The setting `language` (`auto`, `en`, `ja`). `auto` follows Claude Code's `language` setting, then
the locale, else English.

## Settings and limits

### Settings (userConfig)

| Key | Values | Default |
| --- | --- | --- |
| `language` | `auto`, `en`, `ja` | `auto` |
| `shortCommands` | also register `/tree` and `/git` | `false` |
| `commandTimeoutSeconds` | the command time limit (1 to 600) | `30` |

### Limits and safety

- peek only reads; the only thing it writes is the command history in `$.store`
- The command view runs only commands the person typed. It runs outside the sandbox, as `!` mode
  does
- One drawing takes at most 100,000 characters, so text, output and diffs are cut at 90,000, and
  the header says so. A diff is cut between hunks
- External commands: git (the tree's marks, the Git view, the project's files), ghq (repository
  candidates), fd (file candidates outside git). Without any of them, peek works and leaves out
  what it would add

### Limits

| What | Limit | Past it | Constant |
| --- | --- | --- | --- |
| Size of a file to open | 4 MiB | not opened; once open, what was shown stays | `MAX_READ_BYTES` (`find.ts`) |
| Characters in one drawing | 90,000 | cut, said in the header | `DRAW_LIMIT` (`pure/markdown.ts`) |
| Characters before the lines a file opens at | 20,000 | the head is cut | `BEFORE_LIMIT` (`ui/file.tsx`) |
| Clickable links in one drawing | 256 | the rest show as text | `MAX_LINKS` (`ui/file.tsx`) |
| Changed lines a diff is worked out for | 1,000 | the changed part shows as replaced whole | `MAX_EDITS` (`pure/diff.ts`) |
| Rows the tree opens at first | 200 | the smaller folders open, as many as fit | `FIRST_ROWS` (`views/tree.ts`) |
| Entries of one folder | 100 | the rest become one "…N more" row | `PER_DIR` (`pure/tree.ts`) |
| Rows of the tree | 1,000 | cut, said in the header | `MAX_ROWS` (`pure/tree.ts`) |
| Commits in the history | 40 | not shown | `LOG_COUNT` (`views/git.ts`) |
| Time a command runs | 30 seconds (1 to 600 by the setting) | stopped, and the view says so | the setting `commandTimeoutSeconds` |
| Commands kept in the history | 20 | the oldest go | `HISTORY` (`views/command.ts`) |
| Completions | 10 | not shown | `MAX_SUGGESTIONS` (`register.tsx`) |

## Implementation

### State

State is gathered into one value (atom) per file, and only the file that declares a value reads
and writes it (Claude Code lists what a mod reads and writes from these per-file atoms).

| Value | Holds |
| --- | --- |
| `nav` | whether the pane is open, the current view, the Back history |
| `file` | the path, the label, the text, the modification time, the baseline for changes (the text at the last message), whether it was deleted, source / rendered / changes, the lines opened at |
| `tree` | the root and how it is written, the branch, the open folders, the folders shown whole, the selected folder, each folder's listing, Git's marks, what Git ignores |
| `git` | the repository's root and how it is written, the status, the history, the chosen commit and its details |
| `command` | the command, the working directory it ran in (**Run again** runs there too), standard output, standard error, the exit code, and the seconds it was stopped at when it hit the time limit |
| `offer` | the `.md` a reply touched or the file it cited lines of; kept until opened or dismissed from the band |

- The views are held apart so that Git's read every 5 seconds does not redraw the other views
- The time of the last read, the stale marks and the last `git status` output are held in module
  variables, not in values: writing what drawing does not use would redraw the pane

### Files

```
hooks/
  register.tsx      only wires events and commands
  nav.ts            the current view and the Back history, opening and closing the pane
  views/file.ts     the file view's state and steps
  views/tree.ts     the tree view's state and steps
  views/git.ts      the Git view's state and steps
  views/command.ts  the command view's state and steps, the history of runs ($.store)
  find.ts           resolving targets and the fuzzy candidates (conversation, project, ghq), reading files
  prompt.ts         quoting into the prompt and adding @ mentions
  run.ts            running Git without the index lock, the clock, how often views are read again
  ui/*.tsx          the pane and the band, each view's drawing
  pure/
    paths.ts        resolving and labelling paths, the files the conversation named, ranking candidates
    quote.ts        quote headings and finding the lines of selected text
    markdown.ts     links, front matter, cutting at the drawing limit
    diff.ts         line diffs and hunks
    git.ts          parsing Git's output (status v2, log with a graph, show split by file)
    tree.ts         building rows and the tree's string from listings
    terminal.ts     removing ANSI and control characters from command output and handling \r, turning control characters in other strings into pictures
    target.ts       parsing /peek's argument (!, git, path:line)
  messages.ts       the messages in English and Japanese, choosing the language
```

## Tests

- The pure functions (`pure/`) are tested directly. Parsing Git's output is checked against real
  output (renames, untracked files, no upstream, a detached HEAD, a graph with merges, an empty
  repository, quoted paths)
- Each view's behaviour is checked with Claude Code's test kit. `process.run` dispatches on argv to
  stand in for the output of git, ghq and the shell. `$.fs` is stood in for too, symbolic links
  included. Re-reading is checked by advancing a mock clock
- The test kit checks the drawn elements by the same rules as the real screen and reports a
  drawing that fails them as a failed test. For file contents, names and Git output holding control
  characters, each view checks that the drawn strings have pictures in their place
- What the test kit cannot check is checked on the real screen (the list below)

### Checked on the real screen

With Claude Code 2.1.316 running in tmux, these have been checked:

- Opening at a line scrolls that line near the top of the freshly opened pane, marked by a
  background colour. The same holds when opened from a Markdown link's `#L40-L42`
- In a tree of 1,000 rows, the click that shows the rest, scrolling and the click that opens a
  file respond at once
- `$SHELL -ic` reads the interactive startup files (zsh) in under a second and prints no stray
  warnings
- Opened together with the built-in `/diff`, the tabs line up in the side pane and switch on a
  click. While `/diff`'s tab is shown, the band narrows within a second to the view switches,
  **Quote selection** and **Close**. From there `/peek` or a view switch in the band brings peek's
  tab to the front, scrolled to the lines if given, with the prompt keeping the keys

Colours in themes other than dark are not checked yet: `/theme` rewrites the person's settings, and
there is no way to check without changing the local settings.

## Out of scope

- The diff of the work in progress. The built-in `/diff` already has the file list, the changes by
  turn and the `ask` button
- Editing files and Git operations
- Closing on send. Watching Claude's fixes beside the chat is common
- A view that keeps streaming the output of a command that does not end (`tail -f` and the like).
  If needed, `$.process.spawn` can add it
- Colours in command output. They are removed; if needed, ANSI colours can be mapped to `Text`
  colours

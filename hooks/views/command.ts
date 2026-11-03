// The command view: the last command run in the person's shell, its output, and the commands
// run before (kept across sessions).

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CommandRun, Location } from '../../types'
import { where } from '../find'
import type { Messages } from '../messages'
import type { Opened } from '../nav'
import { lines } from '../pure/diff'
import { fenced } from '../pure/markdown'
import { locate } from '../pure/quote'
import type { Quoted } from '../pure/quote'
import { clean, dropShellNoise } from '../pure/terminal'
import { now } from '../run'

type Api = EngineInterface

// How many commands completion remembers.
const HISTORY = 20
// The time a command may run when the setting says nothing usable.
const DEFAULT_TIMEOUT_SECONDS = 30

// Read and written only in this file (see views/file.ts).
const command = atom({ plugin: 'peek', key: 'command' } as const, null, { shape: 'command-1' })

// The seconds a command may run, from the settings.
let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS

// Takes the time limit of this load of the module: a whole number of seconds from 1 to 600.
export function configureCommand(option: unknown): void {
  const seconds = Math.floor(Number(option))
  timeoutSeconds = seconds >= 1 ? Math.min(seconds, 600) : DEFAULT_TIMEOUT_SECONDS
}

// The last command run, for a drawing, which a change to it then redraws.
export async function shownCommand($: Api): Promise<CommandRun | null> {
  return read($, command)
}

// The commands run before, the newest first.
export async function recentCommands($: Api): Promise<string[]> {
  const stored = await $.store.get('commands').catch(() => undefined)
  return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
}

async function remember($: Api, text: string): Promise<void> {
  const commands = [text, ...(await recentCommands($)).filter(item => item !== text)].slice(0, HISTORY)
  await $.store.set('commands', commands).catch(() => undefined)
}

// The number of the latest run, so a run that ends after a later one started leaves that one
// shown, and whether the latest is under way (a running mark an earlier load of the module left
// is not).
let latest = 0
let isBusy = false

// Forgets what an earlier load of the module was running.
export function resetCommand(): void {
  latest = 0
  isBusy = false
}

// How sh starts the person's shell ($0) on the command ($1), for any shell.
// - stdin is /dev/null, as with nothing typed in a terminal: a tool that takes a pipe as its input
//   in place of the folder (rg, say) would search an empty pipe and find nothing, and the engine
//   only writes text to a pipe.
// - The shell runs in a session of its own (perl's setsid, as macOS has no setsid command), so it
//   has no controlling terminal. The engine's children share Claude Code's, where a program that
//   opens /dev/tty (fzf, glow, sudo's password prompt) would draw over Claude Code's screen and
//   read its keys; Esc in fzf can end the session. Without one, such a program fails and says why.
//   Without perl the shell starts as it is.
const START =
  'command -v perl >/dev/null 2>&1 && exec perl -MPOSIX -e \'POSIX::setsid(); exec @ARGV or die "$!\\n"\' -- "$0" -ic "$1" </dev/null; ' +
  'exec "$0" -ic "$1" </dev/null'

// What a run came to: what it printed and how it ended, or why it did not run.
async function execute($: Api, text: string, dir: string): Promise<Omit<CommandRun, 'command' | 'cwd'>> {
  const shell = (await $.env.get('SHELL').catch(() => undefined)) || '/bin/sh'
  const started = await now($)
  const elapsed = async () => {
    const ended = await now($)
    return started !== undefined && ended !== undefined ? ended - started : undefined
  }
  try {
    const result = await $.process.run(['/bin/sh', '-c', START, shell, text], {
      cwd: dir,
      env: { PEEK: '1' },
      stdin: '',
      timeoutMs: timeoutSeconds * 1000,
    })
    const seconds = Math.floor(((await elapsed()) ?? 0) / 1000)
    return { stdout: clean(result.stdout), stderr: dropShellNoise(clean(result.stderr)), exitCode: result.exitCode, ...(seconds >= 1 ? { seconds } : {}) }
  } catch (error) {
    // The engine rejects a run that outlasts its time; any other rejection is a failure to run.
    const ms = await elapsed()
    if (ms !== undefined && ms >= timeoutSeconds * 1000) return { stdout: '', stderr: '', exitCode: null, stoppedAfter: timeoutSeconds }
    const message = error instanceof Error ? error.message : String(error)
    return { stdout: '', stderr: clean(message), exitCode: null }
  }
}

// Starts `text` in the person's shell, interactive so that their aliases and functions are there,
// in `cwd` (the working directory unless given), and marks it running at once: the same command
// keeps what it printed before until it ends. `ended` resolves once it ended, with whether its
// output is the one shown (a later run took its place otherwise). PEEK=1 lets a shell's startup
// files turn on what they keep off inside Claude Code.
export async function startCommand($: Api, text: string, cwd?: string): Promise<{ ended: Promise<boolean> }> {
  const dir = cwd ?? (await where($)).cwd
  latest += 1
  const id = latest
  isBusy = true
  await update($, command, shown =>
    shown?.command === text && shown.cwd === dir
      ? { ...shown, isRunning: true }
      : { command: text, cwd: dir, stdout: '', stderr: '', exitCode: null, isRunning: true },
  )
  await remember($, text)
  const ended = execute($, text, dir).then(async result => {
    if (id !== latest) return false
    isBusy = false
    await update($, command, () => ({ command: text, cwd: dir, ...result }))
    return true
  })
  return { ended }
}

// Runs the last command again, where it ran; nothing while it still runs.
export async function rerunCommand($: Api): Promise<{ ended: Promise<boolean> } | undefined> {
  const shown = await read($, command)
  if (!shown || (shown.isRunning && isBusy)) return undefined
  return startCommand($, shown.command, shown.cwd)
}

// The rows the view draws under its header, a gap between each part: the output; the errors
// under their heading; or, with neither, the line that says so.
function outputRows(shown: CommandRun): number {
  const output = lines(shown.stdout).length
  const errors = shown.stderr.trim() === '' ? 0 : lines(shown.stderr).length
  if (output + errors === 0) return 1
  return errors === 0 ? output : output + (output > 0 ? 1 : 0) + 2 + errors
}

// What showing the command view comes to: the last command's output, or why there is none.
export async function loadCommand($: Api, say: Messages): Promise<Opened> {
  const shown = await read($, command)
  if (!shown) return { error: say.commandHint }
  const title = `$ ${shown.command}`
  return { title, label: title, lines: outputRows(shown) }
}

// Where the command view is, for Back.
export async function commandLocation($: Api): Promise<Location | undefined> {
  return (await read($, command)) ? { view: 'command' } : undefined
}

// A selection from the output, headed by the command; undefined when it is not in the output.
export async function commandQuote($: Api, selected: string): Promise<Quoted | undefined> {
  const shown = await read($, command)
  if (!shown || !locate(`${shown.stdout}\n${shown.stderr}`, selected)) return undefined
  return { head: `$ ${shown.command}`, text: selected }
}

// The whole output as a block for the prompt: the command, then what it printed.
export async function commandBlock($: Api): Promise<string | undefined> {
  const shown = await read($, command)
  if (!shown) return undefined
  const errors = shown.stderr.trim() ? `\n\nstderr:\n${fenced(shown.stderr)}` : ''
  return `$ ${shown.command}\n${fenced(shown.stdout)}${errors}`
}

// The output, to copy.
export async function commandOutput($: Api): Promise<string | undefined> {
  return (await read($, command))?.stdout
}

// Running git to read a repository, the clock, and when a view that reads again while shown is
// due.

import type { EngineInterface } from 'claude-code'

type Api = EngineInterface

// git without taking the index lock, which a git of Claude's may be holding, and writing paths as
// they are rather than quoting each byte past ASCII in octal (core.quotePath, by environment since
// git 2.31 so the arguments stay git's own).
const GIT_ENV = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.quotePath',
  GIT_CONFIG_VALUE_0: 'false',
}

// What `git <args>` printed in `cwd`, or undefined when it failed or could not run.
export async function runGit($: Api, args: readonly string[], cwd: string): Promise<string | undefined> {
  const result = await $.process.run(['git', ...args], { cwd, env: GIT_ENV }).catch(() => undefined)
  return result?.exitCode === 0 ? result.stdout : undefined
}

// The time now, or undefined when the engine cannot say.
export async function now($: Api): Promise<number | undefined> {
  return $.clock.now().catch(() => undefined)
}

// When a view is read again: every `every` milliseconds, at once when something may have changed
// what it shows, and one read at a time.
export function rereads(every: number) {
  let readAt: number | undefined
  let isStale = false
  let isReading = false
  // Runs `read` unless another read is under way, telling it whether something may have changed
  // the view; a change marked while it runs is read at the next tick.
  const run = async (read: (wasStale: boolean) => Promise<void>): Promise<void> => {
    if (isReading) return
    isReading = true
    const wasStale = isStale
    isStale = false
    try {
      await read(wasStale)
    } finally {
      isReading = false
    }
  }
  return {
    // Forgets what an earlier load of the module was doing.
    reset(): void {
      readAt = undefined
      isStale = false
      isReading = false
    },
    // Something may have changed what the view shows.
    markStale(): void {
      isStale = true
    },
    // The view was read at `at`.
    done(at: number | undefined): void {
      readAt = at
    },
    run,
    // At a tick `at`, reads the view again when it is due: in full (`reload`) when something may
    // have changed it, else only when `moved`, which reads less, finds that what it shows moved.
    async tick(at: number | undefined, moved: () => Promise<boolean>, reload: () => Promise<void>): Promise<void> {
      if (!isStale && readAt !== undefined && (at === undefined || at - readAt < every)) return
      await run(async wasStale => {
        if (wasStale || (await moved())) await reload()
        else readAt = at
      })
    },
  }
}

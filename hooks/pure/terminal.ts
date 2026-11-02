// A command's output made drawable: no escape sequences or control characters. Pure.

// Removes ANSI escape sequences (colours, cursor moves, hyperlinks), keeps what a carriage
// return overwrites last on each line (a progress bar's final state), and drops every other
// control character but the tab and the newline, which a drawing refuses.
export function clean(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .split('\n')
    .map(line => line.replace(/\r$/, '').split('\r').pop() ?? '')
    .join('\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

// What an interactive shell without a terminal warns of before every command, not the command's.
const SHELL_NOISE = [/^\(eval\):\d+: can't change option: zle$/]

// Standard error without the shell's warnings.
export function dropShellNoise(stderr: string): string {
  return stderr
    .split('\n')
    .filter(line => !SHELL_NOISE.some(noise => noise.test(line)))
    .join('\n')
}

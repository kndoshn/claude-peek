// Text made drawable: a command's output without escape sequences or control characters, and any
// other text with its control characters shown. Pure.

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
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
}

// `text` as a drawing takes it, each line where it was: a CRLF line ending as a newline, and any
// other control character but the tab and the newline as its picture (␛ for an escape, ␍ for a
// carriage return), or U+FFFD for one of the C1 range, which has none.
export function visible(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, char => {
    const code = char.charCodeAt(0)
    if (code < 0x20) return String.fromCharCode(0x2400 + code)
    return code === 0x7f ? '\u2421' : '\ufffd'
  })
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

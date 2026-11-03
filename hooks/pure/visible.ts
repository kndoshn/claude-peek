// Text made drawable: its control characters shown as their pictures. Pure.

// `text` as a drawing takes it, each line where it was: a CRLF line ending as a newline, and any
// other control character but the tab and the newline as its picture (␛ for an escape, ␍ for a
// carriage return), or U+FFFD for one of the C1 range, which has none.
export function visible(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, char => {
    const code = char.charCodeAt(0)
    if (code < 0x20) return String.fromCharCode(0x2400 + code)
    return code === 0x7f ? '␡' : '�'
  })
}

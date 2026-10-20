import { DEFAULT_GAME_BUILD } from '../core/engine/constraints.ts'

/**
 * The script that the pages of frames run before their own, which gives
 * them what FiveM's NUI gives the documents of its frames: the game that
 * it runs and its build, the languages of the system, and invokeNative,
 * which tells the dev UI what pages ask of it; and to the pages of the
 * frames of resources, those that the frames of others are in not,
 * GetParentResourceName, by the name of the frame, which the dev UI names
 * after the resource, and a frameLoaded message to the frame they are in.
 * Those also tell the dev UI where the cursor is over them, once a frame,
 * which it cannot tell itself while they have the cursor.
 */
export const FRAME_SCRIPT = `(() => {
  const define = (name, value) =>
    Object.defineProperty(window, name, { value, writable: false, enumerable: true, configurable: true })
  define('nuiTargetGame', 'gta5')
  define('nuiTargetGameBuild', ${DEFAULT_GAME_BUILD})
  define('nuiTargetGamePureLevel', 0)
  define('nuiSystemLanguages', [...navigator.languages])
  define('invokeNative', (native, arg) => {
    window.top.postMessage({ type: 'fiverunner:invokeNative', native: String(native), arg: String(arg) }, '*')
  })
  window.registerEpoxyHandler = () => {}
  define('sendEpoxyMessage', () => {})
  if (window.parent !== window && window.parent === window.top) {
    const resource = window.name
    window.GetParentResourceName = function () {
      return resource
    }
    window.parent.postMessage({ type: 'frameLoaded', frameName: resource }, '*')
    let moved = false
    let x = 0
    let y = 0
    const tell = () => {
      moved = false
      window.parent.postMessage({ type: 'fiverunner:cursor', x, y }, '*')
    }
    window.addEventListener(
      'mousemove',
      (event) => {
        x = event.clientX
        y = event.clientY
        if (!moved) requestAnimationFrame(tell)
        moved = true
      },
      { capture: true, passive: true },
    )
  }
})()`

/** The start of an HTML document up to its doctype: a byte order mark, then white space and comments. */
const DOCTYPE = /^(?:\xef\xbb\xbf)?(?:[\t\n\f\r ]|<!--[^]*?-->)*<!doctype[^>]*>/i

/**
 * The bytes of an HTML document with `script` before its own scripts:
 * right after its doctype, which keeps it in the mode the doctype gives it,
 * or at its start. Documents in UTF-16, by their byte order marks, stay as
 * they are.
 */
export function withScript(html: Uint8Array, script: string): Uint8Array {
  if ((html[0] === 0xff && html[1] === 0xfe) || (html[0] === 0xfe && html[1] === 0xff)) return html
  const text = String.fromCharCode(...html.subarray(0, Math.min(html.length, 4096)))
  const doctype = DOCTYPE.exec(text)?.[0].length
  const at = doctype ?? (text.startsWith('\xef\xbb\xbf') ? 3 : 0)
  const tag = new TextEncoder().encode(`<script>${script}</script>`)
  const result = new Uint8Array(html.length + tag.length)
  result.set(html.subarray(0, at))
  result.set(tag, at)
  result.set(html.subarray(at), at + tag.length)
  return result
}

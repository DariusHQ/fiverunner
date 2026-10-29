import { DEFAULT_GAME_BUILD } from '../core/engine/constraints.ts'
import { DEV_PATH } from './routes.ts'

/**
 * Browsers have no nui:// scheme, at which FiveM's NUI serves the files of
 * resources as at https://cfx-nui-<resource>, and those of its own at
 * nui://game/ui/, of which the dev UI serves jQuery under DEV_PATH: URLs
 * of nui:// go there.
 */
export function nuiUrls(text: string): string {
  return text.replaceAll('nui://game/', `${DEV_PATH}game/`).replaceAll('nui://', 'https://cfx-nui-')
}

/**
 * The script that the pages of frames run before their own, which gives
 * them what FiveM's NUI gives the documents of its frames: the game that
 * it runs and its build, the languages of the system, and invokeNative,
 * which tells the dev UI what pages ask of it; and to the pages of the
 * frames of resources, those that the frames of others are in not,
 * GetParentResourceName, by the name of the frame, which the dev UI names
 * after the resource, and a frameLoaded message to the frame they are in.
 * Those also tell the dev UI where the cursor is over them, once a frame,
 * which it cannot tell itself while they have the cursor. The nui:// URLs
 * that pages give the sources, links and styles of their elements, and
 * fetch, go where nuiUrls puts them.
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
  const nui = (value) => value.replaceAll('nui://game/', '${DEV_PATH}game/').replaceAll('nui://', 'https://cfx-nui-')
  const fetch = window.fetch
  if (typeof fetch === 'function') {
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? '' : String(input)
      return fetch.call(window, url.startsWith('nui://') ? nui(url) : input, init)
    }
  }
  if (typeof MutationObserver === 'function') {
    const attributes = ['src', 'href', 'srcset', 'poster', 'style']
    const fix = (element) => {
      for (const name of attributes) {
        const value = element.getAttribute(name)
        if (value !== null && value.includes('nui://')) element.setAttribute(name, nui(value))
      }
    }
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') fix(record.target)
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue
          fix(node)
          for (const child of node.querySelectorAll('[src], [href], [srcset], [poster], [style]')) fix(child)
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: attributes })
  }
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

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * The bytes of an HTML document with its nui:// URLs where nuiUrls puts
 * them, before its parser fetches those of its scripts. Documents that are
 * not UTF-8 stay as they are.
 */
export function withNuiUrls(html: Uint8Array): Uint8Array {
  let text: string
  try {
    text = strict.decode(html)
  } catch {
    return html
  }
  return text.includes('nui://') ? new TextEncoder().encode(nuiUrls(text)) : html
}

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

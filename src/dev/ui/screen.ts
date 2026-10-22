import type { NuiFrame } from '../../core/engine/index.ts'
import { devFrameUrl } from '../hosts.ts'

/** The size of the game window that the screens of players stand for, in pixels, which pages are laid out in. */
export const GAME_WIDTH = 1920
export const GAME_HEIGHT = 1080

/** The names that FiveM's keyboard mapper gives the keys of KeyboardEvent.code, but for letters, digits and function keys. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  Escape: 'ESCAPE',
  Enter: 'RETURN',
  Backspace: 'BACK',
  Tab: 'TAB',
  Space: 'SPACE',
  CapsLock: 'CAPITAL',
  ShiftLeft: 'LSHIFT',
  ShiftRight: 'RSHIFT',
  ControlLeft: 'LCONTROL',
  ControlRight: 'RCONTROL',
  AltLeft: 'LMENU',
  AltRight: 'RMENU',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  PageUp: 'PAGEUP',
  PageDown: 'PAGEDOWN',
  Home: 'HOME',
  End: 'END',
  Insert: 'INSERT',
  Delete: 'DELETE',
  NumpadMultiply: 'MULTIPLY',
  NumpadAdd: 'ADD',
  NumpadSubtract: 'SUBTRACT',
  NumpadDecimal: 'DECIMAL',
  NumpadDivide: 'DIVIDE',
}

/** The name that FiveM's keyboard mapper gives the key of a KeyboardEvent.code, if FiveRunner knows of it. */
export function keyName(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code
  if (/^Numpad\d$/.test(code)) return `NUMPAD${code.slice(6)}`
  return KEY_NAMES[code]
}

/** What a screen needs of the dev UI. */
export interface ScreenHost {
  /** Loads the bridge of the origin of the frame at `url`, if the dev UI has the origin, and resolves once it is ready. */
  bridge(url: string): Promise<void>
  /** Tells the client where the cursor is in its game window. */
  cursor(x: number, y: number): void
  /** Tells the game of the client that a key of its keyboard went down or up, by the name of FiveM's keyboard mapper. */
  key(name: string, down: boolean): void
}

/**
 * The screen of a player, which shows the frames of its client over where
 * the game would be, as the root page of FiveM's NUI shows them: in the
 * order they came, the focused one on top, each hidden until its page
 * loads. Frames take the mouse while NUI shows the cursor, and the keyboard
 * while it has the focus; while the screen itself has the focus, its keys
 * go to the game.
 */
export class Screen {
  readonly element: HTMLElement
  readonly #viewport: HTMLElement
  readonly #client: number
  readonly #tab: string
  readonly #port: string
  readonly #host: ScreenHost
  readonly #frames = new Map<string, HTMLIFrameElement>()
  /** The frames that wait for their bridges, by the number of the wait, which a later one replaces. */
  readonly #waiting = new Map<string, number>()
  #waits = 0
  /** The frames from the bottom up, and those that asked for the focus, the last first. */
  #zStack: string[] = []
  #focusStack: string[] = []
  #scale = 1
  /** The keys that went down to the game, which go up as the screen loses the focus. */
  readonly #held = new Set<string>()

  constructor(client: number, tab: string, port: string, host: ScreenHost) {
    this.#client = client
    this.#tab = tab
    this.#port = port
    this.#host = host
    this.element = document.createElement('div')
    this.element.className = 'screen'
    this.element.tabIndex = 0
    this.#viewport = document.createElement('div')
    this.#viewport.className = 'viewport'
    this.#viewport.style.width = `${GAME_WIDTH}px`
    this.#viewport.style.height = `${GAME_HEIGHT}px`
    this.element.append(this.#viewport)
    new ResizeObserver(() => {
      this.#scale = this.element.clientWidth / GAME_WIDTH
      this.#viewport.style.transform = `scale(${this.#scale})`
    }).observe(this.element)
    this.element.addEventListener('keydown', (event) => this.#key(event, true))
    this.element.addEventListener('keyup', (event) => this.#key(event, false))
    this.element.addEventListener('blur', () => {
      for (const name of this.#held) this.#host.key(name, false)
      this.#held.clear()
    })
    this.element.addEventListener('mousedown', () => this.element.focus())
    this.element.addEventListener('mousemove', (event) => {
      const rect = this.#viewport.getBoundingClientRect()
      this.#cursor(
        (event.clientX - rect.left) / this.#scale,
        (event.clientY - rect.top) / this.#scale,
      )
    })
  }

  /** The resource whose frame has `source` as its window. */
  frameOf(source: MessageEventSource | null): string | undefined {
    for (const [resource, frame] of this.#frames) {
      if (frame.contentWindow === source) return resource
    }
    return undefined
  }

  /** Takes where the cursor is over a frame, which the frame told. */
  cursorOver(x: number, y: number): void {
    this.#cursor(x, y)
  }

  async create({ resource, url }: NuiFrame): Promise<void> {
    const wait = ++this.#waits
    this.#waiting.set(resource, wait)
    const src = devFrameUrl(url, this.#client, this.#tab, this.#port)
    await this.#host.bridge(src)
    if (this.#waiting.get(resource) !== wait) return
    this.#waiting.delete(resource)
    const frame = document.createElement('iframe')
    frame.name = resource
    frame.style.visibility = 'hidden'
    frame.allow = "microphone *; camera *; autoplay; payment 'none'; geolocation 'none';"
    frame.sandbox.value = 'allow-forms allow-scripts allow-same-origin'
    frame.src = src
    frame.tabIndex = -1
    frame.addEventListener('load', () => {
      frame.style.visibility = 'visible'
    })
    this.#frames.set(resource, frame)
    this.#zStack.push(resource)
    // A new frame leaves the focus where it was.
    const focused = document.activeElement
    this.#viewport.append(frame)
    if (focused instanceof HTMLIFrameElement && focused !== frame) focused.focus()
  }

  destroy(resource: string): void {
    this.#waiting.delete(resource)
    const frame = this.#frames.get(resource)
    if (frame === undefined) return
    this.#zStack = this.#zStack.filter((name) => name !== resource)
    frame.remove()
    this.#frames.delete(resource)
  }

  /** Posts a frame the message that `json` holds, as an object, as FiveM does. */
  message(resource: string, json: string): void {
    this.#frames.get(resource)?.contentWindow?.postMessage(JSON.parse(json), '*')
  }

  frameFocus(resource: string, focused: boolean): void {
    if (focused) this.#focusFrame(resource)
    else this.#blurFrame(resource)
  }

  zIndex(resource: string, zIndex: number): void {
    const frame = this.#frames.get(resource)
    if (frame !== undefined) frame.style.zIndex = String(zIndex)
  }

  /** Gives the frames the mouse, if NUI shows the cursor, and leaves them the keyboard only while it has the focus. */
  focus(focus: boolean, cursor: boolean): void {
    this.element.classList.toggle('nui-cursor', cursor)
    this.element.classList.toggle('nui-focus', focus)
    const focused = document.activeElement
    if (!focus && focused instanceof HTMLIFrameElement && this.frameOf(focused.contentWindow)) {
      this.element.focus()
    }
  }

  /** Puts a frame on top, and gives it the focus. */
  #focusFrame(resource: string): void {
    this.#zStack = [...this.#zStack.filter((name) => name !== resource), resource]
    this.#focusStack = [resource, ...this.#focusStack.filter((name) => name !== resource)]
    this.#zStack.forEach((name, index) => {
      const frame = this.#frames.get(name)
      if (frame !== undefined) frame.style.zIndex = String(index)
    })
    const frame = this.#frames.get(resource)
    if (frame === undefined) return
    frame.style.zIndex = '99999'
    frame.contentWindow?.focus()
  }

  /** Takes the focus from a frame, which goes to the frame that last asked for it before. */
  #blurFrame(resource: string): void {
    this.#focusStack = this.#focusStack.filter((name) => name !== resource)
    this.#frames.get(resource)?.contentWindow?.blur()
    const [next] = this.#focusStack
    if (next !== undefined) this.#focusFrame(next)
  }

  /** Tells the game of a key that went down or up on the screen, which takes it from the page. */
  #key(event: KeyboardEvent, down: boolean): void {
    const name = keyName(event.code)
    if (name === undefined || event.target !== this.element) return
    event.preventDefault()
    if (down && event.repeat) return
    if (down) this.#held.add(name)
    else if (!this.#held.delete(name)) return
    this.#host.key(name, down)
  }

  #cursor(x: number, y: number): void {
    this.#host.cursor(Math.round(x), Math.round(y))
  }
}

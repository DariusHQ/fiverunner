import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Where Chrome is on this machine: CHROME_PATH, or where its installers put it. */
export function findChrome(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  return candidates.find((path) => path !== undefined && path !== '' && existsSync(path))
}

/** What a target of Chrome, such as a page, a frame or a worker, logged or threw. */
export interface Logged {
  readonly target: string
  readonly text: string
}

/** A message of the DevTools protocol, with the session of the target it came from. */
interface Message {
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: unknown
  readonly sessionId?: string
}

/**
 * Chrome without a window, with a profile of its own, which the tests drive
 * through the DevTools protocol: it attaches to every target as it comes,
 * and keeps what they log and the contexts their scripts run in.
 */
export class Chrome {
  readonly logged: Logged[] = []
  readonly #process: ChildProcess
  readonly #profile: string
  readonly #socket: WebSocket
  readonly #waiting = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >()
  readonly #targets = new Map<string, string>()
  readonly #contexts: { session: string; id: number; origin: string }[] = []
  readonly #listeners = new Map<
    string,
    (params: Record<string, unknown>, session: string) => void
  >()
  #next = 1

  private constructor(process: ChildProcess, profile: string, socket: WebSocket) {
    this.#process = process
    this.#profile = profile
    this.#socket = socket
    socket.addEventListener('message', ({ data }) =>
      this.#receive(JSON.parse(String(data)) as Message),
    )
  }

  static async launch(path: string): Promise<Chrome> {
    const profile = mkdtempSync(join(tmpdir(), 'fiverunner-chrome-'))
    const child = spawn(path, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--window-size=1400,1000',
      'about:blank',
    ])
    const url = await new Promise<string>((resolve, reject) => {
      let text = ''
      child.stderr!.on('data', (chunk: Buffer) => {
        text += chunk.toString()
        const found = /DevTools listening on (ws:\S+)/.exec(text)
        if (found !== null) resolve(found[1]!)
      })
      child.on('exit', () => reject(new Error(`Chrome exited: ${text}`)))
    })
    const socket = new WebSocket(url)
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
    const chrome = new Chrome(child, profile, socket)
    await chrome.send('Target.setDiscoverTargets', { discover: true })
    await chrome.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    })
    return chrome
  }

  send(method: string, params: Record<string, unknown> = {}, session?: string): Promise<unknown> {
    const id = this.#next++
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject })
      this.#socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(session === undefined ? {} : { sessionId: session }),
        }),
      )
    })
  }

  /** Opens `url` in a page, and returns the session of the page. */
  async open(url: string): Promise<Page> {
    const { targetId } = (await this.send('Target.createTarget', { url: 'about:blank' })) as {
      targetId: string
    }
    const { sessionId } = (await this.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    })) as {
      sessionId: string
    }
    await this.#attach(sessionId, 'page')
    await this.send('Page.enable', {}, sessionId)
    await this.send('Page.navigate', { url }, sessionId)
    return new Page(this, sessionId)
  }

  /** Evaluates `expression` in the last context of a frame whose origin is `origin`, or of the page itself. */
  async evaluate(expression: string, origin: string, session?: string): Promise<unknown> {
    const context = this.#contexts.findLast(
      (found) => found.origin === origin && (session === undefined || found.session === session),
    )
    if (context === undefined) throw new Error(`No context at ${origin}`)
    const result = (await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, contextId: context.id },
      context.session,
    )) as {
      result: { value?: unknown }
      exceptionDetails?: { text: string; exception?: { description?: string } }
    }
    if (result.exceptionDetails !== undefined) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      )
    }
    return result.result.value
  }

  /** Has `listener` hear the events of `method`, with the sessions of the targets they came from. */
  on(method: string, listener: (params: Record<string, unknown>, session: string) => void): void {
    this.#listeners.set(method, listener)
  }

  /** The origins of the contexts that scripts run in, those of frames too. */
  get origins(): string[] {
    return [...new Set(this.#contexts.map(({ origin }) => origin))]
  }

  close(): void {
    this.#socket.close()
    this.#process.kill()
    try {
      rmSync(this.#profile, { recursive: true, force: true, maxRetries: 5 })
    } catch {
      // Chrome may hold its profile for a moment as it exits.
    }
  }

  async #attach(session: string, type: string): Promise<void> {
    this.#targets.set(session, type)
    await this.send('Runtime.enable', {}, session).catch(() => {})
    await this.send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      session,
    ).catch(() => {})
  }

  #receive(message: Message): void {
    if (message.id !== undefined) {
      const waiting = this.#waiting.get(message.id)
      this.#waiting.delete(message.id)
      if (message.error !== undefined) waiting?.reject(new Error(JSON.stringify(message.error)))
      else waiting?.resolve(message.result)
      return
    }
    const params = message.params ?? {}
    const session = message.sessionId ?? ''
    this.#listeners.get(message.method ?? '')?.(params, session)
    switch (message.method) {
      case 'Target.attachedToTarget': {
        const { sessionId, targetInfo } = params as {
          sessionId: string
          targetInfo: { type: string; url: string }
        }
        void this.#attach(sessionId, `${targetInfo.type} ${targetInfo.url}`)
        break
      }
      case 'Runtime.executionContextCreated': {
        const { context } = params as {
          context: { id: number; origin: string; auxData?: { isDefault?: boolean } }
        }
        if (context.auxData?.isDefault !== false) {
          this.#contexts.push({ session, id: context.id, origin: context.origin })
        }
        break
      }
      case 'Runtime.consoleAPICalled': {
        const { type, args } = params as {
          type: string
          args: { value?: unknown; description?: string }[]
        }
        const text = args.map((arg) => String(arg.value ?? arg.description)).join(' ')
        this.logged.push({
          target: this.#targets.get(session) ?? session,
          text: `${type}: ${text}`,
        })
        break
      }
      case 'Runtime.exceptionThrown': {
        const { exceptionDetails } = params as {
          exceptionDetails: { text: string; exception?: { description?: string } }
        }
        const text = exceptionDetails.exception?.description ?? exceptionDetails.text
        this.logged.push({
          target: this.#targets.get(session) ?? session,
          text: `exception: ${text}`,
        })
        break
      }
    }
  }
}

/** A page of Chrome. */
export class Page {
  readonly #chrome: Chrome
  readonly #session: string

  constructor(chrome: Chrome, session: string) {
    this.#chrome = chrome
    this.#session = session
  }

  /** Evaluates `expression` in the page, or in its frames at `origin`. */
  evaluate<T>(expression: string, origin?: string): Promise<T> {
    if (origin !== undefined) return this.#chrome.evaluate(expression, origin) as Promise<T>
    return this.#chrome
      .send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        this.#session,
      )
      .then((result) => {
        const { result: value, exceptionDetails } = result as {
          result: { value?: unknown }
          exceptionDetails?: { text: string; exception?: { description?: string } }
        }
        if (exceptionDetails !== undefined) {
          throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
        }
        return value.value as T
      })
  }

  /** Waits until `expression` is truthy in the page, or in its frames at `origin`, and returns what it was. */
  async until<T>(expression: string, origin?: string, timeout = 15000): Promise<T> {
    const start = Date.now()
    let last: unknown
    for (;;) {
      try {
        last = await this.evaluate(expression, origin)
        if (last) return last as T
      } catch (error) {
        last = error
      }
      if (Date.now() - start > timeout)
        throw new Error(`Timed out waiting for ${expression}: ${String(last)}`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  /** Loads `url` in the page, and waits until it loaded. */
  async goto(url: string): Promise<void> {
    await this.#chrome.send('Page.navigate', { url }, this.#session)
    await this.until(
      `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`,
    )
  }

  /**
   * Records the page frame by frame, as Chrome paints it, as JPEG, with the
   * time each frame came in milliseconds, into `frames`, and gives what stops it.
   */
  async record(frames: { data: string; time: number }[]): Promise<() => Promise<void>> {
    this.#chrome.on('Page.screencastFrame', (params, session) => {
      if (session !== this.#session) return
      const { data, sessionId } = params as { data: string; sessionId: number }
      frames.push({ data, time: Date.now() })
      void this.#chrome.send('Page.screencastFrameAck', { sessionId }, this.#session)
    })
    await this.#chrome.send(
      'Page.startScreencast',
      { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080 },
      this.#session,
    )
    return async () => {
      await this.#chrome.send('Page.stopScreencast', {}, this.#session)
    }
  }

  /** Types `text` into what has the focus, as a keyboard would. */
  async type(text: string): Promise<void> {
    await this.#chrome.send('Input.insertText', { text }, this.#session)
  }

  /** Lays the page out at `width` by `height` pixels. */
  async resize(width: number, height: number): Promise<void> {
    await this.#chrome.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      this.#session,
    )
  }

  /** A screenshot of the viewport of the page, or of where `clip` is in the document, as PNG. */
  async screenshot(clip?: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<Uint8Array> {
    const { data } = (await this.#chrome.send(
      'Page.captureScreenshot',
      { format: 'png', ...(clip === undefined ? {} : { clip: { ...clip, scale: 1 } }) },
      this.#session,
    )) as { data: string }
    return Buffer.from(data, 'base64')
  }

  /** Clicks the page at `x`, `y`, which are in its viewport. */
  async click(x: number, y: number): Promise<void> {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.#chrome.send(
        'Input.dispatchMouseEvent',
        { type, x, y, button: 'left', clickCount: 1 },
        this.#session,
      )
    }
  }

  /** Drags the mouse from `x`, `y` to `toX`, `toY`, through `steps` moves that each take `pause` milliseconds. */
  async drag(
    x: number,
    y: number,
    toX: number,
    toY: number,
    steps = 30,
    pause = 16,
  ): Promise<void> {
    const send = (type: string, at: readonly [number, number], buttons: number) =>
      this.#chrome.send(
        'Input.dispatchMouseEvent',
        { type, x: at[0], y: at[1], button: 'left', buttons, clickCount: 1 },
        this.#session,
      )
    await send('mouseMoved', [x, y], 0)
    await send('mousePressed', [x, y], 1)
    for (let step = 1; step <= steps; step++) {
      await send('mouseMoved', [x + ((toX - x) * step) / steps, y + ((toY - y) * step) / steps], 1)
      await new Promise((done) => setTimeout(done, pause))
    }
    await send('mouseReleased', [toX, toY], 0)
  }

  /** Turns the wheel of the mouse at `x`, `y`, by `deltaY` pixels, down for more. */
  async wheel(x: number, y: number, deltaY: number): Promise<void> {
    await this.#chrome.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseWheel', x, y, deltaX: 0, deltaY },
      this.#session,
    )
  }

  /** Presses a key of the keyboard, by its KeyboardEvent code, key and key code, with the text it types if any, on what has the focus. */
  async press(code: string, key: string, keyCode: number, text?: string): Promise<void> {
    for (const type of ['keyDown', 'keyUp']) {
      const typed = type === 'keyDown' && text !== undefined ? { text } : {}
      await this.#chrome.send(
        'Input.dispatchKeyEvent',
        { type, code, key, windowsVirtualKeyCode: keyCode, ...typed },
        this.#session,
      )
      await new Promise((done) => setTimeout(done, 120))
    }
  }
}

import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { DEFAULT_GAME_BUILD } from '../../src/core/engine/index.ts'
import { FRAME_SCRIPT, nuiUrls, withNuiUrls, withScript } from '../../src/dev/frame.ts'

/** A window that runs FRAME_SCRIPT as the page of a frame named `name`, with what its frames were posted. */
function frameWindow(name: string, nesting: 'resource' | 'nested' | 'top') {
  const posted: { to: string; message: unknown }[] = []
  const frame = (to: string) => ({
    postMessage: (message: unknown) => posted.push({ to, message }),
  })
  const top = frame('top')
  const listeners: Record<string, (event: unknown) => void> = {}
  const options: Record<string, unknown> = {}
  const frames: (() => void)[] = []
  const window: Record<string, unknown> = {
    name,
    navigator: { languages: ['ro-RO', 'en-US'] },
    addEventListener: (type: string, listener: (event: unknown) => void, given: unknown) => {
      listeners[type] = listener
      options[type] = given
    },
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
  }
  window.window = window
  window.top = nesting === 'top' ? window : top
  window.parent = nesting === 'resource' ? top : nesting === 'nested' ? frame('parent') : window
  runInNewContext(FRAME_SCRIPT, window)
  return { window, posted, listeners, options, frames }
}

describe('The script of frames', () => {
  it('gives the pages of the frames of resources what FiveM gives them', () => {
    const { window, posted } = frameWindow('bank', 'resource')
    const invoke = window.invokeNative as (native: unknown, arg: unknown) => void
    invoke('quit', 1)
    invoke(2, undefined)
    // Pages cannot change what FiveM gives them as read only.
    const changed = Reflect.set(window, 'nuiTargetGame', 'rdr3')
    expect([
      (window.GetParentResourceName as () => string)(),
      changed,
      window.nuiTargetGame,
      window.nuiTargetGameBuild,
      window.nuiTargetGamePureLevel,
      window.nuiSystemLanguages,
      window.nuiSystemLanguages === (window.navigator as { languages: unknown }).languages,
      typeof window.registerEpoxyHandler,
      typeof window.sendEpoxyMessage,
      posted,
    ]).toEqual([
      'bank',
      false,
      'gta5',
      DEFAULT_GAME_BUILD,
      0,
      ['ro-RO', 'en-US'],
      false,
      'function',
      'function',
      [
        { to: 'top', message: { type: 'frameLoaded', frameName: 'bank' } },
        { to: 'top', message: { type: 'fiverunner:invokeNative', native: 'quit', arg: '1' } },
        { to: 'top', message: { type: 'fiverunner:invokeNative', native: '2', arg: 'undefined' } },
      ],
    ])
  })

  it('keeps the name of the frame of the resource, as it is, as pages rename it', () => {
    const { window } = frameWindow(' bank ', 'resource')
    window.name = 'other'
    expect((window.GetParentResourceName as () => string)()).toBe(' bank ')
  })

  it('tells where the cursor is over the frames of resources, once a frame', () => {
    const { posted, listeners, options, frames } = frameWindow('bank', 'resource')
    listeners.mousemove!({ clientX: 10, clientY: 20 })
    listeners.mousemove!({ clientX: 30, clientY: 40 })
    const queued = frames.length
    frames.splice(0).forEach((frame) => frame())
    listeners.mousemove!({ clientX: 50, clientY: 60 })
    frames.splice(0).forEach((frame) => frame())
    expect([options.mousemove, queued, posted.slice(1)]).toEqual([
      { capture: true, passive: true },
      1,
      [
        { to: 'top', message: { type: 'fiverunner:cursor', x: 30, y: 40 } },
        { to: 'top', message: { type: 'fiverunner:cursor', x: 50, y: 60 } },
      ],
    ])
  })

  it('gives frames in pages, and pages of no frames, no resource name', () => {
    const nested = frameWindow('inner', 'nested')
    const top = frameWindow('', 'top')
    expect([
      nested.window.GetParentResourceName,
      nested.window.nuiTargetGame,
      nested.posted,
      nested.listeners,
      top.window.GetParentResourceName,
    ]).toEqual([undefined, 'gta5', [], {}, undefined])
  })
})

const encoder = new TextEncoder()
/** Decodes UTF-8, keeping byte order marks. */
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const BOM = String.fromCharCode(0xfeff)

describe('Scripts in HTML', () => {
  it('go right after the doctype, past byte order marks, white space and comments', () => {
    const inject = (html: string | Uint8Array) =>
      decoder.decode(withScript(typeof html === 'string' ? encoder.encode(html) : html, 'x()'))
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('<!DOCTYPE html><p>')])
    expect([
      inject('<!doctype html>\n<html><p>hi</p>'),
      inject(' <!-- a --> <!DOCTYPE html PUBLIC "x"><p>'),
      inject('<html><p>no doctype</p>'),
      inject(bom),
      inject(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x70, 0x3e])),
    ]).toEqual([
      '<!doctype html><script>x()</script>\n<html><p>hi</p>',
      ' <!-- a --> <!DOCTYPE html PUBLIC "x"><script>x()</script><p>',
      '<script>x()</script><html><p>no doctype</p>',
      `${BOM}<!DOCTYPE html><script>x()</script><p>`,
      `${BOM}<script>x()</script><p>`,
    ])
  })

  it('leave documents in UTF-16 as they are, by their byte order marks', () => {
    const utf16 = [
      new Uint8Array([0xff, 0xfe, 0x3c, 0x00]),
      new Uint8Array([0xfe, 0xff, 0x00, 0x3c]),
    ]
    const other = new Uint8Array([0xff, 0x3c])
    expect([...utf16, other].map((html) => withScript(html, 'x()'))).toEqual([
      ...utf16,
      new Uint8Array([...encoder.encode('<script>x()</script>'), 0xff, 0x3c]),
    ])
  })
})

describe('The nui:// URLs of pages', () => {
  it('go to the files of resources at https://cfx-nui-, and those of FiveM at nui://game/ to the dev UI', () => {
    const text = `<script src="nui://game/ui/jquery.js"></script><img src="nui://ox_inventory/web/images/money.png">`
    expect(nuiUrls(text)).toBe(
      '<script src="/__fiverunner/game/ui/jquery.js"></script><img src="https://cfx-nui-ox_inventory/web/images/money.png">',
    )
  })

  it('go there in the documents of pages in UTF-8, which keep their byte order marks, but not in others', () => {
    const utf8 = encoder.encode(`${BOM}<img alt="ă" src="nui://bank/logo.png">`)
    const latin1 = Uint8Array.from(
      [...'<p>\xe9</p><img src="nui://bank/logo.png">'].map((c) => c.charCodeAt(0)),
    )
    const plain = encoder.encode('<p>no URLs</p>')
    expect([decoder.decode(withNuiUrls(utf8)), withNuiUrls(latin1), withNuiUrls(plain)]).toEqual([
      `${BOM}<img alt="ă" src="https://cfx-nui-bank/logo.png">`,
      latin1,
      plain,
    ])
  })

  it('go there as pages fetch them, as the script of frames has them', () => {
    const fetched: unknown[] = []
    const window: Record<string, unknown> = {
      name: 'bank',
      navigator: { languages: [] },
      addEventListener: () => {},
      fetch: (input: unknown) => fetched.push(input),
    }
    window.window = window
    window.top = window
    window.parent = window
    runInNewContext(FRAME_SCRIPT, window)
    const fetch = window.fetch as (input: string) => void
    for (const url of ['nui://game/ui/jquery.js', 'nui://bank/data.json', 'https://bank/close'])
      fetch(url)
    expect(fetched).toEqual([
      nuiUrls('nui://game/ui/jquery.js'),
      nuiUrls('nui://bank/data.json'),
      'https://bank/close',
    ])
  })
})

import { describe, expect, it } from 'vitest'

import { route } from '../../src/dev/routes.ts'

const origin = 'http://cfx-nui-bank.c1.tab.fiverunner.localhost:30120'

describe('Routes of frames', () => {
  it('take the paths of their origins as files, but those of the dev server', () => {
    expect([
      route(new URL(`${origin}/html/app.js?v=1`), origin),
      route(new URL(`${origin}/__fiverunner/sw.js`), origin),
    ]).toEqual([{ kind: 'file', path: '/html/app.js' }, { kind: 'network' }])
  })

  it('ask the client for requests over HTTP to other hosts, and leave the rest to the browser', () => {
    const asked = [
      'https://bank/greet',
      'http://cfx-nui-other/x.png',
      'http://fiverunner.localhost:30120/',
    ]
    expect([
      ...asked.map((url) => route(new URL(url), origin)),
      route(new URL('data:text/plain,x'), origin),
      route(new URL('wss://example.com/'), origin),
    ]).toEqual([
      ...asked.map((url) => ({ kind: 'ask', url: new URL(url) })),
      { kind: 'network' },
      { kind: 'network' },
    ])
  })
})

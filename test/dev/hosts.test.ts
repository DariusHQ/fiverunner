import { describe, expect, it } from 'vitest'

import { devFrameUrl, fivemOrigin, frameHost, parseFrameHost } from '../../src/dev/hosts.ts'

describe('Frame hosts', () => {
  it('name an origin for each host of FiveM, client and tab, in lower case', () => {
    expect([
      frameHost({ host: 'cfx-nui-bank', client: 1, tab: 'abc' }),
      frameHost({ host: 'Bank_2', client: 12, tab: 'x9' }),
    ]).toEqual(['cfx-nui-bank.c1.abc.fiverunner.localhost', 'bank_2.c12.x9.fiverunner.localhost'])
  })

  it('give hosts that names cannot have as their bytes in hex, in lower case too', () => {
    const host = frameHost({ host: 'my bank.1', client: 1, tab: 't' })
    const tab = frameHost({ host: `a${String.fromCharCode(9)}b`, client: 1, tab: 't' })
    expect([
      host,
      parseFrameHost(host),
      frameHost({ host: 'My Bank.1', client: 1, tab: 't' }),
      tab,
    ]).toEqual([
      '6d792062616e6b2e31.x.c1.t.fiverunner.localhost',
      { host: 'my bank.1', client: 1, tab: 't' },
      '6d792062616e6b2e31.x.c1.t.fiverunner.localhost',
      '610962.x.c1.t.fiverunner.localhost',
    ])
  })

  it('are parsed back, but for other names', () => {
    expect([
      parseFrameHost('cfx-nui-bank.c3.tab1.fiverunner.localhost'),
      parseFrameHost('bank.c1.tab1.fiverunner.localhost'),
      parseFrameHost('fiverunner.localhost'),
      parseFrameHost('bank.c0.tab1.fiverunner.localhost'),
      parseFrameHost('bank.c1.Tab.fiverunner.localhost'),
      parseFrameHost('bank.c1.tab.fiverunner.localhost.evil.com'),
      parseFrameHost('a.b.c1.tab.fiverunner.localhost'),
      parseFrameHost('6d7.x.c1.tab.fiverunner.localhost'),
    ]).toEqual([
      { host: 'cfx-nui-bank', client: 3, tab: 'tab1' },
      { host: 'bank', client: 1, tab: 'tab1' },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('stand for the origins of FiveM', () => {
    expect([fivemOrigin('cfx-nui-bank'), fivemOrigin('bank')]).toEqual([
      'https://cfx-nui-bank',
      'nui://bank',
    ])
  })
})

describe('Dev frame URLs', () => {
  it('are at frame hosts for the pages of resources, and as they are for the web', () => {
    expect([
      devFrameUrl('https://cfx-nui-Bank/html/index.html?x=1#y', 2, 'tab', '30120'),
      devFrameUrl('nui://bank/ui.html', 1, 'tab', '30120'),
      devFrameUrl('NUI://bank/ui.html', 1, 'tab', '30120'),
      devFrameUrl('nui://bank', 1, 'tab', ''),
      devFrameUrl('https://example.com/ui.html', 1, 'tab', '30120'),
      devFrameUrl('http://cfx-nui-bank/ui.html', 1, 'tab', '30120'),
    ]).toEqual([
      'http://cfx-nui-bank.c2.tab.fiverunner.localhost:30120/html/index.html?x=1#y',
      'http://bank.c1.tab.fiverunner.localhost:30120/ui.html',
      'http://bank.c1.tab.fiverunner.localhost:30120/ui.html',
      'http://bank.c1.tab.fiverunner.localhost/',
      'https://example.com/ui.html',
      'http://cfx-nui-bank/ui.html',
    ])
  })
})

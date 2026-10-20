import { describe, expect, it } from 'vitest'

import { answer, chromiumName, type Answer } from '../../src/dev/answers.ts'
import { createProcess } from '../engine/helpers.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A client with a resource named bank, which echoes what raw requests to it have, and one that never started. */
async function client() {
  const proc = await createProcess({ side: 'client' })
  proc
    .add('bank', {
      'fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
client_script 'client.lua'
ui_page 'html/index.html'
file 'html/index.html'`,
      'client.lua': `RegisterRawNuiCallback('echo', function(req, cb)
    local headers = {}
    for _, header in ipairs(req.rawHeaders) do headers[#headers + 1] = header.key .. '=' .. header.value end
    cb({ body = table.concat({ req.method, req.path, req.body, tostring(req.resource), table.concat(headers, ',') }, ' ') })
end)`,
      'html/index.html': '<p>bank</p>',
    })
    .start()
  proc.add('idle', { 'client.lua': '' })
  return { proc, nui: proc.manager.nui! }
}

/** What an answer stands for: the status and body of its response, or the web. */
function shown(answered: Answer): string {
  return 'network' in answered
    ? 'network'
    : `${answered.response.status} ${decoder.decode(answered.response.body)}`
}

describe('Answers of clients to the service workers of frames', () => {
  it('give the files of the host of the frames', async () => {
    const { nui } = await client()
    expect([
      shown(await answer(nui, 'cfx-nui-bank', { kind: 'file', path: '/html/index.html' })),
      shown(await answer(nui, 'bank', { kind: 'file', path: '/html/index.html' })),
      shown(await answer(nui, 'cfx-nui-bank', { kind: 'file', path: '/missing.html' })),
    ]).toEqual(['200 <p>bank</p>', '200 <p>bank</p>', '404 '])
  })

  it('give the files of resources that started at cfx-nui hosts over HTTPS, and leave others to the web', async () => {
    const { nui } = await client()
    const url = (url: string) =>
      answer(nui, 'cfx-nui-other', {
        kind: 'url',
        url,
        method: 'GET',
        headers: [],
        body: new Uint8Array(),
      })
    expect([
      shown(await url('https://cfx-nui-bank/html/index.html?v=1')),
      shown(await url('https://cfx-nui-idle/client.lua')),
      shown(await url('http://cfx-nui-bank/html/index.html')),
      shown(await url('https://example.com/')),
    ]).toEqual(['200 <p>bank</p>', 'network', 'network', 'network'])
  })

  it('give what callbacks answer, to requests with the Origin of the frames and the names of their headers capitalized', async () => {
    const { proc, nui } = await client()
    const pending = answer(nui, 'cfx-nui-shop', {
      kind: 'url',
      url: 'https://BANK/echo/sub?x=1',
      method: 'POST',
      headers: [
        ['content-type', 'text/plain;charset=UTF-8'],
        ['x-custom-header', 'a'],
        ['origin', 'http://shop.c1.tab.fiverunner.localhost'],
      ],
      body: encoder.encode('hello'),
    })
    proc.tickAt(1)
    expect(shown(await pending)).toBe(
      '200 POST /sub?x=1 hello shop Content-Type=text/plain;charset=UTF-8,Origin=https://cfx-nui-shop,X-Custom-Header=a',
    )
  })

  it('come from nui origins for the frames of nui hosts', async () => {
    const { proc, nui } = await client()
    const pending = answer(nui, 'shop', {
      kind: 'url',
      url: 'http://bank/echo',
      method: 'GET',
      headers: [],
      body: new Uint8Array(),
    })
    proc.tickAt(1)
    expect(shown(await pending)).toBe('200 GET   shop Origin=nui://shop')
  })

  it('give what callbacks answer over HTTP to resources whose names start like cfx-nui hosts', async () => {
    const { proc, nui } = await client()
    proc
      .add('cfx-nui-odd', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'`,
        'client.lua': `RegisterNuiCallback('who', function(data, cb) cb('odd') end)`,
      })
      .start()
    const pending = answer(nui, 'bank', {
      kind: 'url',
      url: 'http://cfx-nui-odd/who',
      method: 'POST',
      headers: [],
      body: new Uint8Array(),
    })
    proc.tickAt(1)
    expect(shown(await pending)).toBe('200 "odd"')
  })
})

describe('Header names of Chromium', () => {
  it('are capitalized word by word', () => {
    expect(['content-type', 'x-a-b', 'accept', '-x', 'a1-b'].map(chromiumName)).toEqual([
      'Content-Type',
      'X-A-B',
      'Accept',
      '-X',
      'A1-B',
    ])
  })
})

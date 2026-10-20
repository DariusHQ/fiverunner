import { describe, expect, it } from 'vitest'

import {
  fromBase64,
  proxiedHttp,
  RemoteSource,
  toBase64,
  type Fetched,
} from '../../src/dev/remote.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe('Remote sources', () => {
  it('list and read what the dev server has, and nothing for what went', () => {
    const asked: string[] = []
    const answers: Record<string, Fetched> = {
      '/__fiverunner/api/list?path=html%2Fa%20b': {
        status: 200,
        body: encoder.encode('[{"name":"x.js","directory":false}]'),
      },
      '/__fiverunner/api/read?path=html%2Fx.js': { status: 200, body: encoder.encode('js') },
    }
    const source = new RemoteSource((url) => {
      asked.push(url)
      return answers[url] ?? { status: 404, body: new Uint8Array() }
    })
    expect([
      source.list('html/a b'),
      decoder.decode(source.read('html/x.js')),
      source.list('gone'),
      source.read('gone.lua'),
      asked,
    ]).toEqual([
      [{ name: 'x.js', directory: false }],
      'js',
      [],
      new Uint8Array(),
      [
        '/__fiverunner/api/list?path=html%2Fa%20b',
        '/__fiverunner/api/read?path=html%2Fx.js',
        '/__fiverunner/api/list?path=gone',
        '/__fiverunner/api/read?path=gone.lua',
      ],
    ])
  })

  it('fail as the dev server does', () => {
    const source = new RemoteSource(() => ({ status: 500, body: new Uint8Array() }))
    expect(() => source.read('a.lua')).toThrow('The dev server failed to read a.lua: 500')
  })
})

describe('Base 64', () => {
  it('goes back and forth for every byte, and for long bodies', () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 3 }, (_, index) => index % 256)
    expect([toBase64(encoder.encode('hi?')), fromBase64(toBase64(bytes))]).toEqual(['aGk/', bytes])
  })
})

describe('HTTP through the dev server', () => {
  it('sends requests as JSON, and takes back responses and failures', async () => {
    const posted: { url: string; body: unknown }[] = []
    const results = [
      { status: 201, headers: [['a', 'b']], body: toBase64(encoder.encode('done')) },
      { code: 6, message: "Couldn't resolve host name" },
    ]
    const http = proxiedHttp(async (url, body) => {
      posted.push({ url, body: JSON.parse(body) })
      return JSON.stringify(results.shift())
    })
    const request = {
      method: 'POST',
      url: 'https://example.com/',
      headers: [['Content-Type', 'text/plain']] as const,
      body: encoder.encode('hi'),
      followLocation: true,
      timeout: 5000,
    }
    const response = await http(request)
    const failure = await http({ ...request, body: new Uint8Array() })
    expect([response, failure, posted]).toEqual([
      { status: 201, headers: [['a', 'b']], body: encoder.encode('done') },
      { code: 6, message: "Couldn't resolve host name" },
      [
        {
          url: '/__fiverunner/api/http',
          body: {
            method: 'POST',
            url: 'https://example.com/',
            headers: [['Content-Type', 'text/plain']],
            body: 'aGk=',
            followLocation: true,
            timeout: 5000,
          },
        },
        {
          url: '/__fiverunner/api/http',
          body: expect.objectContaining({ body: '' }),
        },
      ],
    ])
  })
})

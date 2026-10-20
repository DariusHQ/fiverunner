import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { main } from '../../src/cli/main.ts'
import { cfxlua } from '../lua/helpers.ts'

let root: string
let assets: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fiverunner-'))
  assets = join(root, 'assets')
  mkdirSync(assets)
  writeFileSync(join(assets, 'index.html'), '<p>ui</p>')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A resource named bank in the root, whose directory it returns. */
function bank(): string {
  const directory = join(root, 'bank')
  mkdirSync(directory)
  writeFileSync(join(directory, 'fxmanifest.lua'), `fx_version 'cerulean'`)
  return directory
}

/**
 * Runs fiverunner dev with `args` in `cwd`, which `whileRunning` sees the
 * output of, as it goes on, before the tool is interrupted, and returns its
 * exit code with what it wrote.
 */
async function dev(
  cwd: string,
  args: readonly string[] = [],
  whileRunning: (stdout: () => string) => Promise<void> = async () => {},
  host: { assets?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await main(['dev', ...args], {
    cwd,
    env: {},
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
    color: false,
    cfxlua,
    wasm: () => new Uint8Array([1, 2]),
    assets: host.assets ?? assets,
    interrupted: () => whileRunning(() => stdout),
    now: () => 0,
  })
  return { code, stdout, stderr }
}

/** The status and body of `path` of the dev UI at `url`. */
function get(url: string, path: string): Promise<string> {
  const { port } = new URL(url)
  return new Promise((resolve, reject) => {
    const sent = request(
      { host: '127.0.0.1', port, path, headers: { host: `fiverunner.localhost:${port}` } },
      (response) => {
        let body = ''
        response.on('data', (chunk: Buffer) => (body += chunk.toString()))
        response.on('end', () => resolve(`${response.statusCode} ${body}`))
      },
    )
    sent.on('error', reject)
    sent.end()
  })
}

describe('fiverunner dev', () => {
  it('serves the dev UI of the project until it is interrupted', async () => {
    let served = ''
    let url = ''
    const result = await dev(bank(), ['--port', '0'], async (stdout) => {
      url = /at (\S+)/.exec(stdout())![1]!
      served = await get(url, '/')
    })
    expect([result, served]).toEqual([
      {
        code: 0,
        stdout: `FiveRunner runs the resource bank at ${url}\nPress Ctrl+C to stop\n`,
        stderr: '',
      },
      '200 <p>ui</p>',
    ])
    // It stopped listening as it was interrupted.
    await expect(get(url, '/')).rejects.toThrow()
  })

  it('listens on the port it is given, or on 30120 or the next free port by default', async () => {
    const free = createServer()
    await new Promise<void>((resolve) => free.listen(0, '127.0.0.1', resolve))
    const { port } = free.address() as AddressInfo
    await new Promise((resolve) => free.close(resolve))
    const given = await dev(bank(), ['-p', String(port)])
    const fallback = await dev(join(root, 'bank'))
    const used = Number(/localhost:(\d+)/.exec(fallback.stdout)![1])
    expect([given.stdout.includes(`localhost:${port}/`), used >= 30120 && used < 30140]).toEqual([
      true,
      true,
    ])
  })

  it('tells as files of the project change', async () => {
    const directory = bank()
    const result = await dev(directory, ['-p', '0'], async (stdout) => {
      writeFileSync(join(directory, 'client.lua'), 'print(1)')
      for (let waited = 0; !stdout().includes('Files changed') && waited < 5000; waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    })
    expect(result.stdout.split('\n').slice(2)).toEqual([
      'Files changed: the dev UI runs the project anew',
      '',
    ])
  })

  it('tells servers apart from resources', async () => {
    const server = join(root, 'server')
    mkdirSync(join(server, 'resources'), { recursive: true })
    const result = await dev(server, ['-p', '0'])
    expect(result.stdout).toMatch(
      /^FiveRunner runs the server at http:\/\/fiverunner\.localhost:\d+\/\n/,
    )
  })

  it('shows its help', async () => {
    const result = await dev(root, ['--help'])
    expect([result.code, result.stdout.split('\n')[0], result.stderr]).toEqual([
      0,
      'Usage: fiverunner dev [options]',
      '',
    ])
  })

  it('fails for arguments that make no sense to it', async () => {
    const failed = await Promise.all(
      [
        ['--nope'],
        ['--port'],
        ['-p', 'x'],
        ['--port', '65536'],
        ['-p', '1', 'more'],
        ['--help', 'more'],
      ].map((args) => dev(root, args)),
    )
    expect(failed.map(({ code, stderr }) => [code, stderr.split('\n')[0]])).toEqual([
      [2, 'fiverunner: unknown argument --nope'],
      [2, 'fiverunner: --port needs a port, from 0 to 65535'],
      [2, 'fiverunner: -p needs a port, from 0 to 65535'],
      [2, 'fiverunner: --port needs a port, from 0 to 65535'],
      [2, 'fiverunner: unknown argument more'],
      [2, 'fiverunner: unknown argument --help'],
    ])
  })

  it('needs a project, and a built dev UI', async () => {
    const none = await dev(root, ['-p', '0'])
    const unbuilt = await dev(bank(), ['-p', '0'], undefined, { assets: join(root, 'none') })
    expect([none.code, none.stderr, unbuilt.code, unbuilt.stderr]).toEqual([
      2,
      'fiverunner: there is no FiveM project here: a resource has an fxmanifest.lua or a __resource.lua, and a server a resources directory\n',
      2,
      `fiverunner: the dev UI is not built: there is no ${join(root, 'none', 'index.html')}\n`,
    ])
  })
})

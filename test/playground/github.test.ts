import { describe, expect, it } from 'vitest'

import {
  badgeMarkdown,
  decodeFile,
  formatRepository,
  leftOut,
  loadProject,
  parseRepository,
  placeRepository,
  readManifest,
  readRepository,
  RepositoryError,
  type Fetcher,
} from '../../src/playground/github.ts'

/** A GitHub of `repositories`, by owner/repo, each with its files by their paths, which answers as GitHub's API and raw files do. */
function github(
  repositories: Record<string, Record<string, string | Uint8Array>>,
  asked: string[] = [],
): Fetcher {
  return async (url) => {
    asked.push(url)
    const tree =
      /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^?]+)\?recursive=1$/.exec(
        url,
      )
    if (tree !== null) {
      const files = repositories[`${tree[1]}/${tree[2]}`]
      if (files === undefined) return new Response('{"message":"Not Found"}', { status: 404 })
      const entries = Object.entries(files).map(([path, data]) => ({
        path,
        type: 'blob',
        size: typeof data === 'string' ? new TextEncoder().encode(data).length : data.length,
      }))
      return Response.json({ sha: 'abc', tree: entries, truncated: false })
    }
    const raw = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url)
    if (raw !== null) {
      const path = raw[4]!.split('/').map(decodeURIComponent).join('/')
      const data = repositories[`${raw[1]}/${raw[2]}`]?.[path]
      if (data === undefined) return new Response('404: Not Found', { status: 404 })
      return new Response(typeof data === 'string' ? data : new Uint8Array(data))
    }
    return new Response('', { status: 500 })
  }
}

const MANIFEST = `fx_version 'cerulean'
game 'gta5'
`

describe('links to repositories of GitHub', () => {
  it('name them as owner/repo, with a ref and a directory, or by their URLs', () => {
    expect([
      parseRepository('overextended/ox_lib'),
      parseRepository(' overextended/ox_lib@v3.42.0/ '),
      parseRepository('esx-framework/esx_core/[core]/es_extended'),
      parseRepository('https://github.com/overextended/ox_target'),
      parseRepository('github.com/esx-framework/esx_core/tree/main/%5Bcore%5D/es_extended'),
      parseRepository('https://github.com/a/b.git'),
    ]).toEqual([
      { owner: 'overextended', name: 'ox_lib', ref: 'HEAD', path: '' },
      { owner: 'overextended', name: 'ox_lib', ref: 'v3.42.0', path: '' },
      { owner: 'esx-framework', name: 'esx_core', ref: 'HEAD', path: '[core]/es_extended' },
      { owner: 'overextended', name: 'ox_target', ref: 'HEAD', path: '' },
      { owner: 'esx-framework', name: 'esx_core', ref: 'main', path: '[core]/es_extended' },
      { owner: 'a', name: 'b', ref: 'HEAD', path: '' },
    ])
  })

  it('name nothing that is not a repository, or that leads out of it', () => {
    for (const spec of [
      '',
      'ox_lib',
      '-a/b',
      'a/..',
      'a/b/../c',
      'a/b//c',
      'a/b@',
      'a/b@x y',
      'https://github.com/a/b/blob/main/x.lua',
      'https://example.com/a/b',
      'a/b/%zz',
    ]) {
      expect(parseRepository(spec), spec).toBe(undefined)
    }
  })

  it('come back as they were named, and as a badge that opens them', () => {
    const repository = parseRepository('esx-framework/esx_core@main/[core]/es_extended')!
    expect(formatRepository(repository)).toBe('esx-framework/esx_core@main/[core]/es_extended')
    expect(formatRepository(parseRepository('a/b')!)).toBe('a/b')
    expect(badgeMarkdown(repository, 'https://dariushq.github.io/fiverunner/?gh=x/y')).toBe(
      '[![Run in FiveRunner](https://dariushq.github.io/fiverunner/badge.svg)](https://dariushq.github.io/fiverunner/?gh=esx-framework/esx_core@main/%5Bcore%5D/es_extended)',
    )
  })
})

describe('the files that the playground loads', () => {
  it('leave out what is hidden, what only the game streams, and what is too big', () => {
    expect([
      leftOut('client.lua', 10),
      leftOut('.github/workflows/ci.yml', 10),
      leftOut('.fxap', 10),
      leftOut('web/node_modules/x/index.js', 10),
      leftOut('stream/car.yft', 10),
      leftOut('cars/Stream/car.ytd', 10),
      leftOut('stream.lua', 10),
      leftOut('html/big.png', 9 * 1024 * 1024),
    ]).toEqual([
      undefined,
      'hidden',
      'hidden',
      'hidden',
      'streamed',
      'streamed',
      undefined,
      'too big',
    ])
  })

  it('are text when they are UTF-8 with the extensions of text, and bytes otherwise', () => {
    const latin = new Uint8Array([0x70, 0x72, 0x69, 0x6e, 0x74, 0x28, 0x27, 0xe9, 0x27, 0x29])
    expect([
      decodeFile('client.lua', new TextEncoder().encode("print('é')")),
      decodeFile('client.lua', latin),
      decodeFile('html/logo.png', new Uint8Array([137, 80])),
    ]).toEqual(["print('é')", latin, new Uint8Array([137, 80])])
  })

  it('come from the tree of the ref, raw, by their paths in the directory', async () => {
    const asked: string[] = []
    const read = await readRepository(
      parseRepository('esx-framework/esx_core@main/[core]/es_extended')!,
      () => {},
      github(
        {
          'esx-framework/esx_core': {
            'README.md': 'x',
            '[core]/es_extended/fxmanifest.lua': MANIFEST,
            '[core]/es_extended/stream/a.ytd': 'x',
            '[core]/es_extended/html/logo.png': new Uint8Array([1, 2]),
            '[core]/es_extended/empty.lua': '',
          },
        },
        asked,
      ),
    )
    expect([...read.files]).toEqual([
      ['fxmanifest.lua', MANIFEST],
      ['html/logo.png', new Uint8Array([1, 2])],
      ['empty.lua', ''],
    ])
    expect(read.left).toBe(1)
    expect(asked).toContain(
      'https://raw.githubusercontent.com/esx-framework/esx_core/main/%5Bcore%5D/es_extended/html/logo.png',
    )
    // The tree says what is empty, which needs no request.
    expect(asked.filter((url) => url.endsWith('/empty.lua'))).toEqual([])
  })

  it('stop reading once a file fails, and tell nothing after it', async () => {
    const asked: string[] = []
    const told: number[] = []
    let release = () => {}
    const later = new Promise<void>((resolve) => (release = resolve))
    const paths = ['fxmanifest.lua', 'bad.lua', ...Array.from({ length: 30 }, (_, i) => `${i}.lua`)]
    const slow: Fetcher = async (url) => {
      asked.push(url)
      if (url.includes('/git/trees/')) {
        return Response.json({ tree: paths.map((path) => ({ path, type: 'blob', size: 1 })) })
      }
      if (url.endsWith('/fxmanifest.lua')) return new Response(MANIFEST)
      if (url.endsWith('/bad.lua')) return new Response('', { status: 500 })
      await later
      return new Response('x')
    }
    await expect(
      readRepository(parseRepository('a/b')!, (read) => told.push(read), slow),
    ).rejects.toThrow(new RepositoryError('GitHub answered 500 for bad.lua of a/b.'))
    release()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(told).toEqual([0, 1])
    // The tree, the manifest, and the files that the readers had asked for when bad.lua failed.
    expect(asked.length).toBeLessThan(2 + 12 + 1)
  })

  it('say why GitHub gave none', async () => {
    const progress = () => {}
    await expect(readRepository(parseRepository('a/none')!, progress, github({}))).rejects.toThrow(
      new RepositoryError(
        'GitHub has no public repository a/none with files on its default branch.',
      ),
    )
    const limited: Fetcher = async () =>
      new Response('{}', {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600),
        },
      })
    await expect(readRepository(parseRepository('a/b')!, progress, limited)).rejects.toThrow(
      /60 repositories an hour .* try again in (10|11) minutes/,
    )
    const huge: Fetcher = async () => Response.json({ truncated: true, tree: [] })
    await expect(readRepository(parseRepository('a/b')!, progress, huge)).rejects.toThrow(
      /more files than GitHub lists at once/,
    )
  })
})

describe('manifests', () => {
  it('tell what their resources need and provide, but in comments', () => {
    expect(
      readManifest(`fx_version 'cerulean'
shared_scripts { '@ox_lib/init.lua', 'config.lua' }
server_script "@oxmysql/lib/MySQL.lua"
dependency 'qb-target'
dependencies {
    '/server:7290',
    '/onesync',
    'ox_inventory',
    "require: 1.0.2",
}
provide 'qb-core'
-- dependency 'commented'
--[[ dependencies { 'also' } ]]
`),
    ).toEqual({
      needs: ['qb-target', 'ox_inventory', 'require', 'ox_lib', 'oxmysql'],
      provides: ['qb-core'],
    })
    expect([
      readManifest(`ui_page './html/index.html'`).page,
      readManifest(`ui_page 'https://example.com/page'`).page,
      readManifest(`fx_version 'cerulean'`).page,
    ]).toEqual(['html/index.html', undefined, undefined])
  })
})

describe('repositories laid out as servers', () => {
  it('put a resource in resources/, a server where it is, and a directory of resources in resources/', () => {
    const resource = placeRepository(
      parseRepository('a/shop')!,
      new Map([['fxmanifest.lua', MANIFEST]]),
    )
    const server = placeRepository(
      parseRepository('a/server')!,
      new Map<string, string>([
        ['server.cfg', 'ensure shop'],
        ['resources/[local]/shop/fxmanifest.lua', MANIFEST],
        ['resources/[local]/shop/html/fxmanifest.lua', MANIFEST],
        ['resources/notes/readme.md', ''],
      ]),
    )
    const many = placeRepository(
      parseRepository('a/many')!,
      new Map<string, string>([
        ['[jobs]/police/fxmanifest.lua', MANIFEST],
        ['old/__resource.lua', MANIFEST],
        ['old/fxmanifest.lua', MANIFEST],
      ]),
    )
    expect(
      [resource, server, many].map(({ kind, at, resources }) => [kind, at, [...resources.keys()]]),
    ).toEqual([
      ['resource', 'resources/shop', ['shop']],
      ['server', '', ['shop']],
      ['resources', 'resources', ['police', 'old']],
    ])
  })

  it('load what their resources need, which the playground knows, and start it first', async () => {
    const asked: string[] = []
    const project = await loadProject(
      parseRepository('someone/shop')!,
      [],
      () => {},
      github(
        {
          'someone/shop': {
            'fxmanifest.lua': `${MANIFEST}shared_script '@ox_lib/init.lua'\nserver_script '@oxmysql/lib/MySQL.lua'\ndependency 'unknown_thing'\n`,
            'client.lua': '',
          },
          'overextended/ox_lib': {
            'fxmanifest.lua': `${MANIFEST}dependencies { '/onesync', 'require' }\nui_page 'web/build/index.html'\n`,
            'init.lua': '',
            'web/src/main.tsx': '',
          },
          'overextended/cfxlua-require': {
            'fxmanifest.lua': `${MANIFEST}provide 'require'\n`,
            'init.lua': '',
          },
        },
        asked,
      ),
    )
    expect(project.loaded).toEqual([
      'someone/shop',
      'overextended/ox_lib',
      'overextended/cfxlua-require',
    ])
    expect(project.missing).toEqual(['unknown_thing'])
    expect(project.unbuilt).toEqual(['ox_lib'])
    expect(project.name).toBe('shop')
    expect(Object.keys(project.files)).toEqual([
      'resources/cfxlua-require/fxmanifest.lua',
      'resources/cfxlua-require/init.lua',
      'resources/ox_lib/fxmanifest.lua',
      'resources/ox_lib/init.lua',
      'resources/ox_lib/web/build/index.html',
      'resources/shop/client.lua',
      'resources/shop/fxmanifest.lua',
      'server.cfg',
    ])
    expect(project.files['server.cfg'])
      .toBe(`# Written by the playground for someone/shop: it starts what it loaded, what the rest needs first.
set mysql_connection_string "mysql://root@localhost/fiverunner"
ensure oxmysql
add_ace resource.ox_lib command.add_ace allow
add_ace resource.ox_lib command.remove_ace allow
add_ace resource.ox_lib command.add_principal allow
add_ace resource.ox_lib command.remove_principal allow
set ox:ignoreSecurityAdvisory ["stateBagStrictMode"]
ensure "cfxlua-require"
ensure "ox_lib"
ensure "shop"
`)
  })

  it('load what resources need that their manifests do not say, and tell ox_inventory which framework runs', async () => {
    const project = await loadProject(
      parseRepository('Qbox-project/qbx_core')!,
      [],
      () => {},
      github({
        'Qbox-project/qbx_core': { 'fxmanifest.lua': MANIFEST },
        'overextended/ox_inventory': { 'fxmanifest.lua': MANIFEST, 'data/items.lua': 'return {}' },
        'Qbox-project/qbx_vehicles': { 'fxmanifest.lua': MANIFEST },
      }),
    )
    expect(project.loaded).toEqual([
      'Qbox-project/qbx_core',
      'overextended/ox_inventory',
      'Qbox-project/qbx_vehicles',
    ])
    expect(project.files['server.cfg']).toContain('setr inventory:framework "qbx"\n')
    // The commands that Qbox runs, which its recipe for txAdmin lets it run.
    expect(project.files['server.cfg']).toContain('add_ace resource.qbx_core command allow\n')
  })

  it('load the framework and the target that scripts use without saying so, but for bridges', async () => {
    const load = (name: string) =>
      loadProject(
        parseRepository(name)!,
        [],
        () => {},
        github({
          'someone/job': {
            'fxmanifest.lua': `${MANIFEST}client_scripts { 'client/*.lua' }\n`,
            'client/main.lua': `local QBCore = exports['qb-core']:GetCoreObject()
exports.ox_target:addGlobalPed({})
-- exports['qb-target']:AddBoxZone()
`,
            // Nothing runs it.
            'examples/esx.lua': `local ESX = exports.es_extended:getSharedObject()`,
          },
          'someone/bridge': {
            'fxmanifest.lua': `${MANIFEST}server_scripts { 'bridge/**/*.lua' }\n`,
            'bridge/qb.lua': `return exports["qb-core"]:GetCoreObject()`,
            'bridge/esx/server.lua': `return exports.es_extended:getSharedObject()`,
          },
          'someone/qbox': {
            'fxmanifest.lua': `${MANIFEST}dependency 'qbx_core'\nserver_script 'server.lua'\n`,
            'server.lua': `local QBCore = exports['qb-core']:GetCoreObject()`,
          },
          // What the playground knows needs what it says, whatever the exports that its scripts use.
          'overextended/ox_lib': {
            'fxmanifest.lua': `${MANIFEST}client_script 'init.lua'\n`,
            'init.lua': `exports.ox_target:addModel({})`,
          },
          'qbcore-fivem/qb-core': { 'fxmanifest.lua': MANIFEST },
          'overextended/ox_target': { 'fxmanifest.lua': MANIFEST },
          'Qbox-project/qbx_core': { 'fxmanifest.lua': `${MANIFEST}provide 'qb-core'\n` },
          'overextended/ox_inventory': { 'fxmanifest.lua': MANIFEST },
          'Qbox-project/qbx_vehicles': { 'fxmanifest.lua': MANIFEST },
        }),
      )
    const job = await load('someone/job')
    expect(job.loaded).toEqual(['someone/job', 'overextended/ox_target', 'qbcore-fivem/qb-core'])
    expect(job.files['server.cfg']).toContain(
      'add_ace resource.qb-core command allow\nensure "qb-core"\nensure "ox_target"\nensure "job"\n',
    )
    expect((await load('someone/bridge')).loaded).toEqual(['someone/bridge'])
    expect((await load('someone/qbox')).loaded).toEqual([
      'someone/qbox',
      'Qbox-project/qbx_core',
      'overextended/ox_inventory',
      'Qbox-project/qbx_vehicles',
    ])
    expect((await load('overextended/ox_lib')).loaded).toEqual(['overextended/ox_lib'])
  })

  it('run ox_inventory with the framework of Qbox when nothing brings one', async () => {
    const repositories = {
      'overextended/ox_inventory': { 'fxmanifest.lua': MANIFEST },
      'Qbox-project/qbx_core': { 'fxmanifest.lua': `${MANIFEST}provide 'qb-core'\n` },
      'Qbox-project/qbx_vehicles': { 'fxmanifest.lua': MANIFEST },
      'someone/appearance': {
        'fxmanifest.lua': MANIFEST,
        'sql/playerskins.sql': 'CREATE TABLE IF NOT EXISTS `playerskins` (id INT);',
      },
    }
    const project = await loadProject(
      parseRepository('overextended/ox_inventory')!,
      [],
      () => {},
      github(repositories),
    )
    expect(project.loaded).toEqual([
      'overextended/ox_inventory',
      'Qbox-project/qbx_core',
      'Qbox-project/qbx_vehicles',
    ])
    expect(project.files['server.cfg']).toContain('setr inventory:framework "qbx"\n')
    // The table of skins that qbx_core reads as its menu shows characters, but where a resource creates it.
    expect(project.files['resources/playerskins.sql']).toContain(
      'CREATE TABLE IF NOT EXISTS playerskins',
    )
    const dressed = await loadProject(
      parseRepository('overextended/ox_inventory')!,
      [parseRepository('someone/appearance')!],
      () => {},
      github(repositories),
    )
    expect(Object.keys(dressed.files).filter((path) => path.endsWith('.sql'))).toEqual([
      'resources/appearance/sql/playerskins.sql',
    ])
  })

  it('list repositories through ungh.cc once the hour of GitHub is used, and read their files at the commit that it listed', async () => {
    const files: Record<string, string> = {
      'fxmanifest.lua': MANIFEST,
      'server.lua': `print('mine')`,
    }
    const used = () =>
      new Response('{"message":"API rate limit exceeded"}', {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600),
        },
      })
    const limited: Fetcher = async (url) => {
      if (url.startsWith('https://api.github.com/')) return used()
      if (url === 'https://ungh.cc/repos/someone/mine/files/HEAD') {
        return Response.json({
          meta: { sha: 'c0ffee' },
          files: [
            ...Object.keys(files).map((path) => ({ path, mode: '100644', size: 12 })),
            // A submodule, which GitHub serves no raw files of.
            { path: 'vendor', mode: '160000', size: 0 },
          ],
        })
      }
      if (url.startsWith('https://ungh.cc/')) return new Response('{"error":true}', { status: 404 })
      const raw = /^https:\/\/raw\.githubusercontent\.com\/someone\/mine\/c0ffee\/(.+)$/.exec(url)
      const data = raw === null ? undefined : files[raw[1]!]
      return data === undefined
        ? new Response('404: Not Found', { status: 404 })
        : new Response(data)
    }
    const read = await readRepository(parseRepository('someone/mine')!, () => {}, limited)
    expect([...read.files.keys()]).toEqual(['fxmanifest.lua', 'server.lua'])
    await expect(
      readRepository(parseRepository('someone/gone')!, () => {}, limited),
    ).rejects.toThrow(
      'GitHub has no public repository someone/gone with files on its default branch.',
    )
    // Once ungh.cc lists nothing either, the visitor learns when GitHub lists again.
    const nowhere: Fetcher = async (url) =>
      url.startsWith('https://api.github.com/') ? used() : new Response('', { status: 503 })
    await expect(
      readRepository(parseRepository('someone/mine')!, () => {}, nowhere),
    ).rejects.toThrow(
      "GitHub lets a visitor list 60 repositories an hour without signing in, and this hour's are used: try again in 10 minutes.",
    )
  })

  it('send once more each request that the network drops, and tell of what it drops twice', async () => {
    const repositories = {
      'someone/mine': { 'fxmanifest.lua': MANIFEST, 'server.lua': `print('mine')` },
    }
    const real = github(repositories)
    const tried = new Map<string, number>()
    // The network drops the first request for each URL, and every request for server.lua in `lossy`.
    const flaky =
      (lossy: boolean): Fetcher =>
      async (url, init) => {
        const count = (tried.get(url) ?? 0) + 1
        tried.set(url, count)
        if (count === 1 || (lossy && url.endsWith('/server.lua')))
          throw new TypeError('Failed to fetch')
        return real(url, init)
      }
    const project = await loadProject(parseRepository('someone/mine')!, [], () => {}, flaky(false))
    expect(project.files['resources/mine/server.lua']).toBe(`print('mine')`)
    tried.clear()
    await expect(
      loadProject(parseRepository('someone/mine')!, [], () => {}, flaky(true)),
    ).rejects.toThrow('GitHub could not be reached for server.lua of someone/mine.')
  })

  it('load screencapture for the scripts that need screenshot-basic, which it provides', async () => {
    const project = await loadProject(
      parseRepository('someone/phone')!,
      [],
      () => {},
      github({
        'someone/phone': { 'fxmanifest.lua': `${MANIFEST}dependency 'screenshot-basic'\n` },
        'itschip/screencapture': { 'fxmanifest.lua': `${MANIFEST}provide 'screenshot-basic'\n` },
      }),
    )
    expect(project.loaded).toEqual(['someone/phone', 'itschip/screencapture'])
    expect(project.files['server.cfg']).toContain('ensure "screencapture"\nensure "phone"\n')
  })

  it('load jim_bridge for the scripts that need it, with the framework of Qbox when nothing brings one', async () => {
    const project = await loadProject(
      parseRepository('jimathy/jim-mining')!,
      [],
      () => {},
      github({
        'jimathy/jim-mining': { 'fxmanifest.lua': `${MANIFEST}dependency 'jim_bridge'\n` },
        'jimathy/jim_bridge': { 'fxmanifest.lua': MANIFEST },
        'overextended/ox_lib': { 'fxmanifest.lua': MANIFEST },
        'Qbox-project/qbx_core': { 'fxmanifest.lua': `${MANIFEST}provide 'qb-core'\n` },
        'Qbox-project/qbx_vehicles': { 'fxmanifest.lua': MANIFEST },
        'overextended/ox_inventory': { 'fxmanifest.lua': MANIFEST },
      }),
    )
    expect(project.loaded).toEqual([
      'jimathy/jim-mining',
      'jimathy/jim_bridge',
      'overextended/ox_lib',
      'Qbox-project/qbx_core',
      'overextended/ox_inventory',
      'Qbox-project/qbx_vehicles',
    ])
    // jim_bridge looks for ox_lib and the framework as it starts, and the scripts on it for jim_bridge.
    const config = project.files['server.cfg'] as string
    const order = [...config.matchAll(/^ensure "(.+)"$/gm)].map(([, name]) => name)
    const at = (name: string) => order.indexOf(name)
    expect([
      at('ox_lib') < at('jim_bridge'),
      at('qbx_core') < at('jim_bridge'),
      at('jim_bridge') < at('jim-mining'),
    ]).toEqual([true, true, true])
  })

  it('read no sources of the pages that repositories do not have built', async () => {
    const asked: string[] = []
    const read = await readRepository(
      parseRepository('a/ui')!,
      () => {},
      github(
        {
          'a/ui': {
            'fxmanifest.lua': `${MANIFEST}ui_page 'web/build/index.html'\n`,
            'client.lua': '',
            'web/src/App.tsx': '',
            'web/package.json': '{}',
          },
        },
        asked,
      ),
    )
    expect([[...read.files.keys()], read.left]).toEqual([['fxmanifest.lua', 'client.lua'], 2])
    expect(asked.filter((url) => url.includes('/web/'))).toEqual([])
  })

  it('load the tables that come with ESX, and nothing for a server that has its own server.cfg', async () => {
    const asked: string[] = []
    const esx = await loadProject(
      parseRepository('someone/job')!,
      [],
      () => {},
      github(
        {
          'someone/job': { 'fxmanifest.lua': `${MANIFEST}dependency 'es_extended'\n` },
          'esx-framework/esx_core': {
            '[core]/es_extended/fxmanifest.lua': MANIFEST,
            '[core]/es_extended/es_extended.sql': 'CREATE TABLE users (identifier VARCHAR(60));',
            '[core]/skinchanger/fxmanifest.lua': `${MANIFEST}client_script '@es_extended/locale.lua'\n`,
            '[SQL]/legacy.sql': 'CREATE TABLE users (identifier VARCHAR(60), skin LONGTEXT);',
          },
        },
        asked,
      ),
    )
    expect(esx.loaded).toEqual([
      'someone/job',
      'esx-framework/esx_core/[core]/es_extended',
      'esx-framework/esx_core/[SQL]',
      'esx-framework/esx_core/[core]/skinchanger',
    ])
    // The directories of esx_core share its tree, which GitHub counts once.
    expect(asked.filter((url) => url.includes('/git/trees/'))).toEqual([
      'https://api.github.com/repos/someone/job/git/trees/HEAD?recursive=1',
      'https://api.github.com/repos/esx-framework/esx_core/git/trees/HEAD?recursive=1',
    ])
    // ESX spawns players once skinchanger has loaded their skins.
    expect(esx.files['server.cfg']).toContain(
      'ensure "skinchanger"\nensure "es_extended"\nensure "job"\n',
    )
    // The tables of the recipe take the place of those of es_extended, as the recipe runs only its own.
    expect(Object.keys(esx.files).filter((path) => path.endsWith('.sql'))).toEqual([
      'resources/legacy.sql',
    ])
    expect(esx.left).toBe(1)
    // The commands that ESX runs, which its recipe for txAdmin lets it run.
    expect(esx.files['server.cfg']).toContain(`add_ace resource.es_extended command.add_ace allow
add_ace resource.es_extended command.add_principal allow
add_ace resource.es_extended command.remove_principal allow
add_ace resource.es_extended command.stop allow
`)
    const server = await loadProject(
      parseRepository('someone/server')!,
      [],
      () => {},
      github({
        'someone/server': {
          'server.cfg': 'ensure shop',
          'resources/shop/fxmanifest.lua': `${MANIFEST}dependency 'ox_lib'\n`,
        },
      }),
    )
    expect([server.loaded, server.files['server.cfg'], server.missing]).toEqual([
      ['someone/server'],
      'ensure shop',
      ['ox_lib'],
    ])
  })

  it('fail on repositories with no resource, and on files that two of them have', async () => {
    const progress = () => {}
    await expect(
      loadProject(
        parseRepository('a/docs')!,
        [],
        progress,
        github({ 'a/docs': { 'README.md': '' } }),
      ),
    ).rejects.toThrow(/a\/docs has no FiveM resource/)
    await expect(
      loadProject(
        parseRepository('a/one')!,
        [parseRepository('b/one')!],
        progress,
        github({
          'a/one': { 'fxmanifest.lua': MANIFEST },
          'b/one': { 'fxmanifest.lua': MANIFEST },
        }),
      ),
    ).rejects.toThrow('b/one has resources/one/fxmanifest.lua, which another repository has too.')
  })
})

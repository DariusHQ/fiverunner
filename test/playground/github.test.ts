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
          },
        },
        asked,
      ),
    )
    expect([...read.files]).toEqual([
      ['fxmanifest.lua', MANIFEST],
      ['html/logo.png', new Uint8Array([1, 2])],
    ])
    expect(read.left).toBe(1)
    expect(asked).toContain(
      'https://raw.githubusercontent.com/esx-framework/esx_core/main/%5Bcore%5D/es_extended/html/logo.png',
    )
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
      'ensure "qb-core"\nensure "ox_target"\nensure "job"\n',
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
    const project = await loadProject(
      parseRepository('overextended/ox_inventory')!,
      [],
      () => {},
      github({
        'overextended/ox_inventory': { 'fxmanifest.lua': MANIFEST },
        'Qbox-project/qbx_core': { 'fxmanifest.lua': `${MANIFEST}provide 'qb-core'\n` },
        'Qbox-project/qbx_vehicles': { 'fxmanifest.lua': MANIFEST },
      }),
    )
    expect(project.loaded).toEqual([
      'overextended/ox_inventory',
      'Qbox-project/qbx_core',
      'Qbox-project/qbx_vehicles',
    ])
    expect(project.files['server.cfg']).toContain('setr inventory:framework "qbx"\n')
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
    const esx = await loadProject(
      parseRepository('someone/job')!,
      [],
      () => {},
      github({
        'someone/job': { 'fxmanifest.lua': `${MANIFEST}dependency 'es_extended'\n` },
        'esx-framework/esx_core': {
          '[core]/es_extended/fxmanifest.lua': MANIFEST,
          '[SQL]/legacy.sql': 'CREATE TABLE users (identifier VARCHAR(60));',
        },
      }),
    )
    expect(esx.loaded).toEqual([
      'someone/job',
      'esx-framework/esx_core/[core]/es_extended',
      'esx-framework/esx_core/[SQL]',
    ])
    expect(Object.keys(esx.files)).toContain('resources/legacy.sql')
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

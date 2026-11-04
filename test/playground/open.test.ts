import { describe, expect, it } from 'vitest'

import { formatRepository } from '../../src/playground/github.ts'
import { readLink } from '../../src/playground/open.ts'

/** What the playground reads of a link with the parameters `search`: the names of its repositories, or its problem. */
function read(search: string): readonly string[] | string | undefined {
  const link = readLink(new URLSearchParams(search))
  if (link === undefined || 'problem' in link) return link?.problem
  return [link.main, ...link.also].map((repository) => formatRepository(repository))
}

describe('links of the playground', () => {
  it('name a repository, and those that it runs with, once for each or with commas between them', () => {
    expect([
      read('?gh=a/one'),
      read('?gh=a/one&with=b/two,c/three'),
      read('?gh=a/one&with=b/two&with=c/three,d/four'),
      read('?gh=a/one&with='),
      read(''),
      read('?gh=a/one&with=b/two&with=nope'),
    ]).toEqual([
      ['a/one'],
      ['a/one', 'b/two', 'c/three'],
      ['a/one', 'b/two', 'c/three', 'd/four'],
      ['a/one'],
      undefined,
      'This link names no repository of GitHub: nope.',
    ])
  })
})

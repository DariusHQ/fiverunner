import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('Controls of clients', () => {
  it('show the button of no key, as FiveRunner knows no key bindings', async () => {
    const { run } = await clientOf()
    expect(run(`print(GetControlInstructionalButton(0, 38, true):sub(3) == '')`)).toEqual(['true'])
  })
})

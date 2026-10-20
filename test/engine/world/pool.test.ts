import { describe, expect, it } from 'vitest'

import { Pool } from '../../../src/core/engine/world/pool.ts'

describe('Pools', () => {
  it('name slots by their index and the id they were taken with', () => {
    const pool = new Pool<string>(4)
    expect(pool.add('a')).toBe(0x001)
    expect(pool.add('b')).toBe(0x101)
    expect(pool.get(0x001)).toBe('a')
    expect(pool.get(0x101)).toBe('b')
    expect(pool.get(0x201)).toBeUndefined()
    expect(pool.get(0x002)).toBeUndefined()
    expect(pool.get(0x081)).toBeUndefined()
  })

  it('take the lowest free slot, with a new id', () => {
    const pool = new Pool<string>(4)
    const a = pool.add('a')
    const b = pool.add('b')
    pool.add('c')
    pool.delete(b)
    pool.delete(a)
    expect(pool.get(a)).toBeUndefined()
    // The byte of the slot is free, with the id it had, and the slot holds nothing.
    expect(pool.get(0x081)).toBeUndefined()
    expect(pool.add('d')).toBe(0x002)
    expect(pool.get(a)).toBeUndefined()
    expect(pool.add('e')).toBe(0x102)
    expect(pool.add('f')).toBe(0x301)
    expect([0x002, 0x102, 0x201, 0x301].map((handle) => pool.get(handle))).toEqual([
      'd',
      'e',
      'c',
      'f',
    ])
  })

  it('wrap the ids of slots in 7 bits', () => {
    const pool = new Pool<string>(1)
    let handle = 0
    for (let id = 1; id <= 127; id++) {
      handle = pool.add('a')
      expect(handle).toBe(id)
      pool.delete(handle)
    }
    expect(pool.add('b')).toBe(0)
    expect(pool.get(0)).toBe('b')
  })

  it('know no handle out of them, or of free slots', () => {
    const pool = new Pool<string>(2)
    expect(pool.get(-1)).toBeUndefined()
    expect(pool.get(0x200)).toBeUndefined()
    expect(pool.get(0x080)).toBeUndefined()
  })

  it('grow by half when they are full', () => {
    const pool = new Pool<string>(2)
    pool.add('a')
    pool.add('b')
    expect(pool.add('c')).toBe(0x201)
    expect(pool.size).toBe(3)
    expect(pool.add('d')).toBe(0x301)
    expect(pool.size).toBe(4)
    expect(pool.add('e')).toBe(0x401)
    expect(pool.size).toBe(6)
    expect(pool.get(0x001)).toBe('a')
  })

  it('grow from no slots', () => {
    const pool = new Pool<string>(0)
    expect(pool.add('a')).toBe(0x001)
    expect(pool.size).toBe(1)
  })
})

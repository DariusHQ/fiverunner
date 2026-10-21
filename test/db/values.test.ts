import { describe, expect, it } from 'vitest'

import type { DataType } from '../../src/core/db/ast.ts'
import { crc32, md5, sha1, sha2 } from '../../src/core/db/hash.ts'
import { changeJson, parseJsonPath, removeJson } from '../../src/core/db/json.ts'
import type { SqlValue } from '../../src/core/db/sqlite.ts'
import {
  addInterval,
  dateFormat,
  dateTimeOfNumber,
  intervalOf,
  parseDateTime,
  parseTime,
  week,
} from '../../src/core/db/temporal.ts'
import { decimalType, integerType, type Type } from '../../src/core/db/types.ts'
import {
  doubleText,
  numberPrefix,
  readValue,
  roundDecimal,
  storeValue,
} from '../../src/core/db/values.ts'
import { UTC } from '../../src/core/scripting/time.ts'

function store(type: DataType, value: SqlValue, lenient = false): SqlValue {
  return storeValue(
    value,
    { schema: 'db', table: 't', column: 'c', type, nullable: true },
    { lenient, row: 1, zone: UTC },
  )
}

describe('Stored values', () => {
  it('of integers round half away from zero, and read strings by the number they start with', () => {
    expect(store({ name: 'INT' }, 2.5)).toBe(3)
    expect(store({ name: 'INT' }, -2.5)).toBe(-3)
    expect(store({ name: 'INT' }, ' 42 ')).toBe(42)
    expect(store({ name: 'INT' }, '1e3')).toBe(1000)
    expect(store({ name: 'BIGINT' }, '9007199254740993')).toBe(9007199254740993n)
    expect(() => store({ name: 'INT' }, '12abc')).toThrow("Data truncated for column 'c' at row 1")
    expect(() => store({ name: 'TINYINT' }, 128)).toThrow(
      "Out of range value for column 'c' at row 1",
    )
    expect(store({ name: 'TINYINT' }, 128, true)).toBe(127)
    expect(store({ name: 'TINYINT', unsigned: true }, -5, true)).toBe(0)
  })

  it('of decimals round to their digits, and fail past them', () => {
    expect(store({ name: 'DECIMAL', length: 5, scale: 2 }, '2.675')).toBe(2.68)
    expect(store({ name: 'DECIMAL', length: 5, scale: 2 }, 2.675)).toBe(2.68)
    expect(() => store({ name: 'DECIMAL', length: 5, scale: 2 }, 1000)).toThrow(
      'Out of range value',
    )
    expect(store({ name: 'DECIMAL', length: 5, scale: 2 }, 1000, true)).toBe(999.99)
  })

  it('of strings fail past their lengths in characters, but for spaces', () => {
    expect(store({ name: 'VARCHAR', length: 3 }, 'añb')).toBe('añb')
    expect(store({ name: 'VARCHAR', length: 3 }, 'abc   ')).toBe('abc')
    expect(() => store({ name: 'VARCHAR', length: 3 }, 'abcd')).toThrow(
      "Data too long for column 'c' at row 1",
    )
    expect(store({ name: 'CHAR', length: 5 }, 'ab  ')).toBe('ab')
    expect(store({ name: 'VARCHAR', length: 4 }, 12.5)).toBe('12.5')
  })

  it('of ENUM and SET are their members, as they are written', () => {
    const type: DataType = { name: 'ENUM', values: ['small', 'Large'] }
    expect(store(type, 'LARGE')).toBe('Large')
    expect(store(type, 1)).toBe('small')
    expect(() => store(type, 'huge')).toThrow("Data truncated for column 'c' at row 1")
    expect(store({ name: 'SET', values: ['a', 'b', 'c'] }, 'c,A')).toBe('a,c')
  })

  it('of dates and times are written as MariaDB writes them, from what it reads as them', () => {
    expect(store({ name: 'DATETIME', length: 0 }, '2024-5-6 7:8:9')).toBe('2024-05-06 07:08:09')
    expect(store({ name: 'DATETIME', length: 3 }, '2024-05-06T07:08:09.123456')).toBe(
      '2024-05-06 07:08:09.123',
    )
    expect(store({ name: 'DATE' }, 20240506)).toBe('2024-05-06')
    expect(store({ name: 'DATETIME', length: 0 }, '24-05-06')).toBe('2024-05-06 00:00:00')
    expect(() => store({ name: 'DATE' }, '2024-02-30')).toThrow(
      "Incorrect date value: '2024-02-30' for column `db`.`t`.`c` at row 1",
    )
    expect(() => store({ name: 'TIMESTAMP', length: 0 }, '2050-01-01 00:00:00')).toThrow(
      'Incorrect datetime value',
    )
    expect(store({ name: 'TIME', length: 0 }, '1 02:03:04')).toBe('26:03:04')
    expect(store({ name: 'YEAR' }, '05')).toBe(2005)
    expect(store({ name: 'YEAR' }, 0)).toBe(0)
  })

  it('of JSON must be JSON, as MariaDB checks them', () => {
    expect(store({ name: 'JSON' }, '{"a": 1}')).toBe('{"a": 1}')
    expect(() => store({ name: 'JSON' }, '')).toThrow('CONSTRAINT `c` failed for `db`.`t`')
  })

  it('of NULL fail for columns that may not be NULL', () => {
    expect(() =>
      storeValue(
        null,
        { schema: 'db', table: 't', column: 'c', type: { name: 'INT' }, nullable: false },
        { lenient: false, row: 1, zone: UTC },
      ),
    ).toThrow("Column 'c' cannot be null")
  })
})

describe('Read values', () => {
  const read = (value: SqlValue, type: Type, mode: 'query' | 'execute' = 'query') =>
    readValue(value, type, mode, UTC)

  it('are as oxmysql sets mysql2 up to read them', () => {
    expect(read(1, { field: 'TINY', length: 1, decimals: 0 })).toBe(true)
    expect(read(2, { field: 'TINY', length: 1, decimals: 0 })).toBe(false)
    expect(read(1, { field: 'TINY', length: 1, decimals: 0 }, 'execute')).toBe(1)
    expect(read(1.5, decimalType(5, 2))).toBe('1.50')
    expect(read(9007199254740993n, integerType(20))).toBe('9007199254740993')
    expect(read('2024-01-02 03:04:05', { field: 'DATETIME', length: 19, decimals: 0 })).toBe(
      Date.UTC(2024, 0, 2, 3, 4, 5),
    )
    expect(read('0000-00-00 00:00:00', { field: 'DATETIME', length: 19, decimals: 0 })).toBeNaN()
    expect(read('2024-01-02', { field: 'DATE', length: 10, decimals: 0 })).toBe(
      Date.UTC(2024, 0, 2),
    )
    expect(
      read(new Uint8Array([1, 2]), { field: 'BLOB', length: 0, decimals: 0, binary: true }),
    ).toEqual([1, 2])
    expect(read(5, { field: 'BIT', length: 3, decimals: 0, binary: true })).toBe(false)
    expect(read(Math.fround(1.1), { field: 'FLOAT', length: 12, decimals: 39 })).toBe(1.1)
  })
})

describe('Numbers', () => {
  it('are read from strings as MariaDB reads them', () => {
    expect(numberPrefix(' -12.50e1xyz')).toEqual({
      decimal: '-125',
      value: -125,
      found: true,
      complete: false,
    })
    expect(numberPrefix('abc').found).toBe(false)
  })

  it('round as decimals do, half away from zero', () => {
    expect(roundDecimal('2.345', 2)).toBe('2.35')
    expect(roundDecimal('-2.345', 2)).toBe('-2.35')
    expect(roundDecimal('9.999', 2)).toBe('10.00')
    expect(roundDecimal('-0.001', 2)).toBe('0.00')
  })

  it('that are doubles are written as MariaDB writes them', () => {
    expect([0.1 + 0.2, 1e15, 123456789012345, 1e-5, -0].map(doubleText)).toEqual([
      '0.30000000000000004',
      '1e15',
      '123456789012345',
      '1e-5',
      '-0',
    ])
  })
})

describe('Dates and times', () => {
  it('are read from strings and numbers as MariaDB reads them', () => {
    expect(parseDateTime('2024/05/06 07.08.09.5')).toEqual({
      year: 2024,
      month: 5,
      day: 6,
      hour: 7,
      minute: 8,
      second: 9,
      micro: 500000,
    })
    expect(parseDateTime('20240506070809')).toMatchObject({ year: 2024, second: 9 })
    expect(parseDateTime('69-01-01')).toMatchObject({ year: 2069 })
    expect(parseDateTime('70-01-01')).toMatchObject({ year: 1970 })
    expect(parseDateTime('2024-02-29')).toBeDefined()
    expect(parseDateTime('2023-02-29')).toBeUndefined()
    expect(parseDateTime('0000-00-00')).toMatchObject({ year: 0, month: 0, day: 0 })
    expect(dateTimeOfNumber(240506)).toMatchObject({ year: 2024, month: 5, day: 6 })
    expect(parseTime('-838:59:59')).toEqual({
      negative: true,
      hours: 838,
      minute: 59,
      second: 59,
      micro: 0,
    })
    expect(parseTime('1000:00:00')).toMatchObject({ hours: 838 })
  })

  it('count weeks in the modes of WEEK, as MariaDB documents them', () => {
    expect(week(2008, 2, 20, 0).week).toBe(7)
    expect(week(2008, 2, 20, 1).week).toBe(8)
    expect(week(2008, 12, 31, 1).week).toBe(53)
    expect(week(2000, 1, 1, 0).week).toBe(0)
    expect(week(2000, 1, 1, 2)).toEqual({ week: 52, year: 1999 })
    expect(week(2008, 12, 29, 3)).toEqual({ week: 1, year: 2009 })
  })

  it('add intervals as DATE_ADD does, months first, keeping days months have', () => {
    const date = parseDateTime('2024-01-31 10:00:00')!
    expect(addInterval(date, intervalOf(1, 'MONTH')!)).toMatchObject({ month: 2, day: 29 })
    expect(addInterval(date, intervalOf('1:30', 'HOUR_MINUTE')!)).toMatchObject({
      hour: 11,
      minute: 30,
    })
    expect(addInterval(date, intervalOf('-1 2', 'DAY_HOUR')!)).toMatchObject({ day: 30, hour: 8 })
    expect(addInterval(date, intervalOf(1.5, 'SECOND')!)).toMatchObject({
      second: 1,
      micro: 500000,
    })
  })

  it('are formatted as DATE_FORMAT formats them', () => {
    const date = parseDateTime('2024-05-06 13:08:09.000123')!
    expect(
      dateFormat(
        date,
        '%a %b %c %D %d %e %f %H %h %I %i %j %k %l %M %m %p %r %S %s %T %U %u %V %v %W %w %X %x %Y %y %% %q',
      ),
    ).toBe(
      'Mon May 5 6th 06 6 000123 13 01 01 08 127 13 1 May 05 PM 01:08:09 PM 09 09 13:08:09 18 19 18 19 Monday 1 2024 2024 2024 24 % q',
    )
  })
})

describe('JSON', () => {
  it('changes documents as text, keeping the rest as it was', () => {
    const path = (text: string) => parseJsonPath(text)!
    expect(changeJson('{"a":1}', path('$.b'), '2', 'set')).toBe('{"a":1, "b": 2}')
    expect(changeJson('{"a":1}', path('$.a'), '2', 'insert')).toBe('{"a":1}')
    expect(changeJson('{"a":1}', path('$.b'), '2', 'replace')).toBe('{"a":1}')
    expect(changeJson('[1, 2]', path('$[5]'), '3', 'set')).toBe('[1, 2, 3]')
    expect(changeJson('1', path('$[1]'), '2', 'set')).toBe('[1, 2]')
    expect(removeJson('{"a": 1, "b": 2}', path('$.a'))).toBe('{"b": 2}')
    expect(removeJson('[1, 2, 3]', path('$[last]'))).toBe('[1, 2]')
  })

  it('reads the paths of MariaDB', () => {
    expect(parseJsonPath('$.a."b c"[1][last-1].*[*]**.d')?.steps).toEqual([
      { kind: 'member', key: 'a' },
      { kind: 'member', key: 'b c' },
      { kind: 'item', index: 1, fromEnd: false },
      { kind: 'item', index: 1, fromEnd: true },
      { kind: 'anyMember' },
      { kind: 'anyItem' },
      { kind: 'descendants' },
      { kind: 'member', key: 'd' },
    ])
    expect(parseJsonPath('a.b')).toBeUndefined()
  })
})

describe('Digests', () => {
  const bytes = (text: string) => new TextEncoder().encode(text)

  it('are those of MD5, SHA-1, SHA-2 and CRC-32', () => {
    expect(md5(bytes('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(sha1(bytes('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(sha2(bytes('abc'), 224)).toBe('23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7')
    expect(sha2(bytes('abc'), 256)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha2(bytes('abc'), 384)).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    )
    expect(sha2(bytes('abc'), 512)).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    )
    expect(sha2(bytes('abc'), 100)).toBeUndefined()
    expect(crc32(bytes('MySQL'))).toBe(3259397556)
  })
})

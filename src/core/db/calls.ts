import type { Expression, IntervalUnit } from './ast.ts'
import type { Clause, Compiled, Compiler, Scope } from './compile.ts'
import { SqlError } from './lexer.ts'
import { unsupported } from './parser.ts'
import {
  aggregateType,
  BOOLEAN_RESULT,
  comparesWithoutCase,
  DATE_TYPE,
  datetimeType,
  decimalType,
  DIV_PRECISION_INCREMENT,
  DOUBLE_TYPE,
  integerType,
  isDateType,
  isDecimal,
  isInteger,
  isNumeric,
  isReal,
  isString,
  LONGTEXT_TYPE,
  numericOf,
  stringType,
  timeType,
  YEAR_TYPE,
  type Type,
} from './types.ts'

type Call = Extract<Expression, { kind: 'call' }>

/** The functions MariaDB has that FiveRunner's database does not, which fail with errors that say so. */
const UNSUPPORTED = new Set([
  'BENCHMARK',
  'COMPRESS',
  'UNCOMPRESS',
  'UNCOMPRESSED_LENGTH',
  'DES_ENCRYPT',
  'DES_DECRYPT',
  'ENCODE',
  'DECODE',
  'ENCRYPT',
  'AES_ENCRYPT',
  'AES_DECRYPT',
  'PASSWORD',
  'OLD_PASSWORD',
  'MASTER_POS_WAIT',
  'LOAD_FILE',
  'SOUNDEX',
  'MATCH',
  'ST_ASTEXT',
  'ST_GEOMFROMTEXT',
  'POINT',
  'NAME_CONST',
  'COLUMN_CREATE',
  'COLUMN_GET',
  'COLUMN_JSON',
  'NEXTVAL',
  'LASTVAL',
  'SETVAL',
  'JSON_TABLE',
  'JSON_OVERLAPS',
  'JSON_NORMALIZE',
  'JSON_EQUALS',
  'SFORMAT',
  'NATURAL_SORT_KEY',
  'KDF',
  'RANDOM_BYTES',
])

/** MariaDB's error for a call of a native function with the wrong number of arguments. */
function parameterCount(name: string): SqlError {
  return new SqlError(
    1582,
    '42000',
    `Incorrect parameter count in the call to native function '${name}'`,
  )
}

/** The flags that tell the functions of JSON which of their values are JSON: 1 for each that is, 0 for others. */
function jsonFlags(values: readonly Compiled[]): string {
  return values.map((value) => (value.json === true ? '1' : '0')).join('')
}

/**
 * Compiles a call of one of MariaDB's functions to SQLite, mostly to
 * FiveRunner's own functions of the same names, with the types MariaDB
 * gives their results.
 */
export function compileCall(
  compiler: Compiler,
  expr: Call,
  scope: Scope,
  clause: Clause,
  aliases: 'first' | 'after' | 'none',
): Compiled {
  const name = expr.name
  // MariaDB names functions in errors as the SQL writes them.
  const written = /^\s*([A-Za-z0-9_$]+)/.exec(compiler.sql.slice(expr.start, expr.end))?.[1] ?? name
  const arity = (min: number, max = min) => {
    if (expr.args.length < min || expr.args.length > max) throw parameterCount(written)
  }
  const compile = (arg: Expression) => compiler.expression(arg, scope, clause, aliases)
  const args = () => expr.args.map(compile)
  const aggregateOf = (values: readonly Compiled[]) =>
    values.some((value) => value.aggregate === true) ? { aggregate: true as const } : {}
  const call = (
    fn: string,
    values: readonly Compiled[],
    type: Type,
    extra: readonly string[] = [],
    json = false,
  ): Compiled => ({
    sql: `${fn}(${[...extra, ...values.map((value) => value.sql)].join(', ')})`,
    type,
    ...(json ? { json: true } : {}),
    ...aggregateOf(values),
  })
  const numeric = (value: Compiled): Compiled => ({ ...value, sql: compiler.numeric(value) })
  const ci = (...values: Compiled[]) =>
    values.every(
      (value) =>
        value.type.field === 'NULL' || !isString(value.type) || comparesWithoutCase(value.type),
    )
      ? 1
      : 0
  const binary = (value: Compiled) => (value.type.binary === true ? 1 : 0)
  const text = (length: number, of?: Compiled) =>
    of?.type.binary === true ? stringType(length, true) : stringType(length)

  if (UNSUPPORTED.has(name)) throw unsupported(`the function ${name}`)

  // Aggregates
  const AGGREGATES = [
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'GROUP_CONCAT',
    'JSON_ARRAYAGG',
    'JSON_OBJECTAGG',
    'BIT_AND',
    'BIT_OR',
    'BIT_XOR',
    'STD',
    'STDDEV',
    'STDDEV_POP',
    'STDDEV_SAMP',
    'VARIANCE',
    'VAR_POP',
    'VAR_SAMP',
  ]
  if (AGGREGATES.includes(name)) {
    if (!scope.aggregates) throw new SqlError(1111, 'HY000', 'Invalid use of group function')
    const outer = scope.aggregates
    // Aggregates do not nest.
    scope.aggregates = false
    try {
      return { ...compileAggregate(), aggregate: true }
    } finally {
      scope.aggregates = outer
    }
  }

  function compileAggregate(): Compiled {
    const distinct = expr.distinct === true ? 'DISTINCT ' : ''
    switch (name) {
      case 'COUNT': {
        if (expr.star === true) return { sql: 'COUNT(*)', type: integerType(21) }
        const values = args()
        if (values.length === 1) {
          const [value] = values
          const collate =
            distinct !== '' && comparesWithoutCase(value!.type) && value!.column === undefined
              ? ' COLLATE fr_ci'
              : ''
          return { sql: `COUNT(${distinct}${value!.sql}${collate})`, type: integerType(21) }
        }
        return {
          sql: `COUNT(DISTINCT fr_tuple(${values.map((value) => value.sql).join(', ')}))`,
          type: integerType(21),
        }
      }
      case 'SUM':
      case 'AVG': {
        arity(1)
        const value = compile(expr.args[0]!)
        const type = numericOf(compiler.numericType(value))
        let result: Type
        if (isReal(type) || type.field === 'NULL') result = DOUBLE_TYPE
        else if (name === 'SUM')
          result = decimalType(Math.min(type.length + 22, 65), isDecimal(type) ? type.decimals : 0)
        else
          result = decimalType(
            Math.min(type.length + DIV_PRECISION_INCREMENT + 1, 65),
            (isDecimal(type) ? type.decimals : 0) + DIV_PRECISION_INCREMENT,
          )
        if (isString(value.type)) result = DOUBLE_TYPE
        return { sql: `${name}(${distinct}${compiler.numeric(value)})`, type: result }
      }
      case 'MIN':
      case 'MAX': {
        arity(1)
        const value = compile(expr.args[0]!)
        const collate =
          comparesWithoutCase(value.type) && value.column === undefined ? ' COLLATE fr_ci' : ''
        return {
          sql: `${name}(${distinct}${value.sql}${collate})`,
          type: value.type,
          ...(value.json === true ? { json: true } : {}),
        }
      }
      case 'GROUP_CONCAT': {
        const values = args()
        const order = expr.orderBy?.map((item) => {
          const compiled = compiler.expression(item.expr, scope, 'order clause', 'first')
          const collate =
            comparesWithoutCase(compiled.type) && compiled.column === undefined
              ? ' COLLATE fr_ci'
              : ''
          return `${compiled.sql}${collate}${item.descending ? ' DESC' : ''}`
        })
        const separator = compiler.bind(expr.separator ?? ',')
        const anyBinary = values.some((value) => value.type.binary === true)
        return {
          sql: `fr_group_concat(${separator}, ${distinct === '' ? 0 : 1}, ${ci(...values)}, ${values.map((value) => value.sql).join(', ')}${order === undefined ? '' : ` ORDER BY ${order.join(', ')}`})`,
          type: { ...LONGTEXT_TYPE, ...(anyBinary ? { binary: true } : {}) },
        }
      }
      case 'JSON_ARRAYAGG': {
        arity(1)
        const value = compile(expr.args[0]!)
        const order = expr.orderBy?.map(
          (item) =>
            `${compiler.expression(item.expr, scope, 'order clause').sql}${item.descending ? ' DESC' : ''}`,
        )
        return {
          sql: `fr_json_arrayagg(${value.json === true ? 1 : 0}, ${value.sql}${order === undefined ? '' : ` ORDER BY ${order.join(', ')}`})`,
          type: LONGTEXT_TYPE,
          json: true,
        }
      }
      case 'JSON_OBJECTAGG': {
        arity(2)
        const [key, value] = args() as [Compiled, Compiled]
        return {
          sql: `fr_json_objectagg(${value.json === true ? 1 : 0}, ${key.sql}, ${value.sql})`,
          type: LONGTEXT_TYPE,
          json: true,
        }
      }
      case 'BIT_AND':
      case 'BIT_OR':
      case 'BIT_XOR': {
        arity(1)
        const value = compile(expr.args[0]!)
        const op = name === 'BIT_AND' ? '&' : name === 'BIT_OR' ? '|' : '^'
        return {
          sql: `fr_bit_agg('${op}', ${compiler.numeric(value)})`,
          type: integerType(21, true),
        }
      }
      default: {
        arity(1)
        const value = compile(expr.args[0]!)
        const kind = {
          STD: 'std_pop',
          STDDEV: 'std_pop',
          STDDEV_POP: 'std_pop',
          STDDEV_SAMP: 'std_samp',
          VARIANCE: 'var_pop',
          VAR_POP: 'var_pop',
          VAR_SAMP: 'var_samp',
        }[name]!
        return { sql: `fr_variance('${kind}', ${compiler.numeric(value)})`, type: DOUBLE_TYPE }
      }
    }
  }

  switch (name) {
    // Control flow
    case 'IF': {
      arity(3)
      const [condition, then, otherwise] = args() as [Compiled, Compiled, Compiled]
      return {
        sql: `(CASE WHEN ${condition.sql} THEN ${then.sql} ELSE ${otherwise.sql} END)`,
        type: aggregateType([then.type, otherwise.type]),
        ...(then.json === true && otherwise.json === true ? { json: true } : {}),
        ...aggregateOf([condition, then, otherwise]),
      }
    }
    case 'IFNULL':
    case 'NVL': {
      arity(2)
      const values = args()
      return {
        ...call('COALESCE', values, aggregateType(values.map((value) => value.type))),
        ...(values.every((value) => value.json === true) ? { json: true } : {}),
      }
    }
    case 'COALESCE': {
      if (expr.args.length === 0) throw parameterCount(written)
      const values = args()
      return {
        ...call('COALESCE', values, aggregateType(values.map((value) => value.type))),
        ...(values.every((value) => value.json === true) ? { json: true } : {}),
      }
    }
    case 'NULLIF': {
      arity(2)
      const [a, b] = args() as [Compiled, Compiled]
      return {
        sql: `(CASE WHEN ${compiler.comparison('=', a, b)} THEN NULL ELSE ${a.sql} END)`,
        type: a.type,
        ...aggregateOf([a, b]),
      }
    }
    case 'ISNULL': {
      arity(1)
      const [value] = args() as [Compiled]
      return { sql: `(${value.sql} IS NULL)`, type: BOOLEAN_RESULT, ...aggregateOf([value]) }
    }
    case 'GREATEST':
    case 'LEAST': {
      if (expr.args.length < 2) throw parameterCount(written)
      const values = args()
      const type = aggregateType(values.map((value) => value.type))
      const kind = values.every((value) => isNumeric(value.type) || value.type.field === 'NULL')
        ? 'n'
        : ci(...values) === 1
          ? 'c'
          : 's'
      return call(
        'fr_greatest',
        values.map((value) => (kind === 'n' ? numeric(value) : value)),
        type,
        [`'${name === 'GREATEST' ? 'g' : 'l'}${kind}'`],
      )
    }
    case 'INTERVAL': {
      if (expr.args.length < 2) throw parameterCount(written)
      return call('fr_interval', args().map(numeric), integerType(11))
    }
    case 'FIELD': {
      if (expr.args.length < 2) throw parameterCount(written)
      const values = args()
      return call('fr_field', values, integerType(3), [String(ci(...values))])
    }
    case 'ELT': {
      if (expr.args.length < 2) throw parameterCount(written)
      const values = args()
      return call('fr_elt', values, aggregateType(values.slice(1).map((value) => value.type)))
    }

    // Strings
    case 'CONCAT': {
      if (expr.args.length === 0) throw parameterCount(written)
      const values = args()
      const length = values.reduce((sum, value) => sum + value.type.length, 0)
      return call('fr_concat', values, {
        ...stringType(
          length,
          values.some((value) => value.type.binary === true),
        ),
      })
    }
    case 'CONCAT_WS': {
      if (expr.args.length < 2) throw parameterCount(written)
      const values = args()
      return call(
        'fr_concat_ws',
        values,
        stringType(
          values.reduce((sum, value) => sum + value.type.length, 0),
          values.some((value) => value.type.binary === true),
        ),
      )
    }
    case 'LENGTH':
    case 'OCTET_LENGTH':
      arity(1)
      return call('fr_length', args(), integerType(10))
    case 'BIT_LENGTH':
      arity(1)
      return {
        ...call('fr_length', args(), integerType(10)),
        sql: `(fr_length(${compile(expr.args[0]!).sql}) * 8)`,
      }
    case 'CHAR_LENGTH':
    case 'CHARACTER_LENGTH': {
      arity(1)
      const [value] = args() as [Compiled]
      return {
        sql: `fr_char_length(${value.sql}, ${binary(value)})`,
        type: integerType(10),
        ...aggregateOf([value]),
      }
    }
    case 'LOWER':
    case 'LCASE':
    case 'UPPER':
    case 'UCASE': {
      arity(1)
      const [value] = args() as [Compiled]
      // The case of binary strings stays as it is.
      if (value.type.binary === true) return value
      return call(
        name === 'LOWER' || name === 'LCASE' ? 'fr_lower' : 'fr_upper',
        [value],
        text(value.type.length, value),
      )
    }
    case 'SUBSTRING': {
      arity(2, 3)
      const values = args()
      const [value, ...rest] = values as [Compiled, ...Compiled[]]
      return {
        sql: `fr_substring(${binary(value)}, ${value.sql}${rest.map((part) => `, ${compiler.numeric(part)}`).join('')})`,
        type: text(value.type.length, value),
        ...aggregateOf(values),
      }
    }
    case 'LEFT':
    case 'RIGHT': {
      arity(2)
      const [value, length] = args() as [Compiled, Compiled]
      return {
        sql: `fr_${name.toLowerCase()}(${value.sql}, ${compiler.numeric(length)}, ${binary(value)})`,
        type: text(value.type.length, value),
        ...aggregateOf([value, length]),
      }
    }
    case 'TRIM': {
      const [subject, side, remove] = expr.args as [Expression, Expression, Expression | undefined]
      const value = compile(subject)
      const sideText = side.kind === 'string' ? side.text : 'BOTH'
      const removed = remove === undefined ? undefined : compile(remove)
      return {
        sql: `fr_trim(${value.sql}, '${sideText}'${removed === undefined ? '' : `, ${removed.sql}`})`,
        type: text(value.type.length, value),
        ...aggregateOf(removed === undefined ? [value] : [value, removed]),
      }
    }
    case 'LTRIM':
    case 'RTRIM': {
      arity(1)
      const [value] = args() as [Compiled]
      return call(`fr_${name.toLowerCase()}`, [value], text(value.type.length, value))
    }
    case 'REPLACE': {
      arity(3)
      const values = args()
      return call('fr_replace', values, text(values[0]!.type.length, values[0]))
    }
    case 'REVERSE': {
      arity(1)
      const [value] = args() as [Compiled]
      return {
        sql: `fr_reverse(${value.sql}, ${binary(value)})`,
        type: text(value.type.length, value),
        ...aggregateOf([value]),
      }
    }
    case 'REPEAT': {
      arity(2)
      const [value, count] = args() as [Compiled, Compiled]
      return {
        sql: `fr_repeat(${value.sql}, ${compiler.numeric(count)})`,
        type: { ...LONGTEXT_TYPE, ...(value.type.binary === true ? { binary: true } : {}) },
        ...aggregateOf([value, count]),
      }
    }
    case 'SPACE':
      arity(1)
      return call('fr_space', args().map(numeric), LONGTEXT_TYPE)
    case 'LPAD':
    case 'RPAD': {
      arity(2, 3)
      const values = args()
      return call(
        `fr_${name.toLowerCase()}`,
        values.map((value, i) => (i === 1 ? numeric(value) : value)),
        text(values[0]!.type.length, values[0]),
      )
    }
    case 'LOCATE': {
      arity(2, 3)
      const values = args()
      const [needle, haystack, start] = values as [Compiled, Compiled, Compiled | undefined]
      return {
        sql: `fr_locate(${needle.sql}, ${haystack.sql}, ${start === undefined ? '1' : compiler.numeric(start)}, ${ci(needle, haystack)})`,
        type: integerType(11),
        ...aggregateOf(values),
      }
    }
    case 'POSITION': {
      arity(2)
      const [needle, haystack] = args() as [Compiled, Compiled]
      return {
        sql: `fr_locate(${needle.sql}, ${haystack.sql}, 1, ${ci(needle, haystack)})`,
        type: integerType(11),
        ...aggregateOf([needle, haystack]),
      }
    }
    case 'INSTR': {
      arity(2)
      const [haystack, needle] = args() as [Compiled, Compiled]
      return {
        sql: `fr_locate(${needle.sql}, ${haystack.sql}, 1, ${ci(needle, haystack)})`,
        type: integerType(11),
        ...aggregateOf([needle, haystack]),
      }
    }
    case 'FIND_IN_SET': {
      arity(2)
      const values = args()
      return {
        sql: `fr_find_in_set(${values[0]!.sql}, ${values[1]!.sql}, ${ci(...values)})`,
        type: integerType(3),
        ...aggregateOf(values),
      }
    }
    case 'ASCII':
      arity(1)
      return call('fr_ascii', args(), integerType(3))
    case 'ORD':
      arity(1)
      return call('fr_ord', args(), integerType(21))
    case 'CHAR':
      if (expr.args.length === 0) throw parameterCount(written)
      return call('fr_char', args().map(numeric), stringType(expr.args.length * 4, true))
    case 'HEX': {
      arity(1)
      const [value] = args() as [Compiled]
      return call(
        'fr_hex',
        [isNumeric(value.type) ? numeric(value) : value],
        stringType(value.type.length * 2),
      )
    }
    case 'UNHEX':
      arity(1)
      return call('fr_unhex', args(), stringType(expr.args.length * 64, true))
    case 'FORMAT': {
      arity(2, 3)
      const values = args()
      return call(
        'fr_format',
        values.map((value, i) => (i < 2 ? numeric(value) : value)),
        stringType(64),
      )
    }
    case 'INSERT': {
      arity(4)
      const values = args()
      return call(
        'fr_insert',
        values.map((value, i) => (i === 1 || i === 2 ? numeric(value) : value)),
        text(values[0]!.type.length + values[3]!.type.length, values[0]),
      )
    }
    case 'STRCMP': {
      arity(2)
      const values = args()
      return {
        sql: `fr_strcmp(${values[0]!.sql}, ${values[1]!.sql}, ${ci(...values)})`,
        type: integerType(2),
        ...aggregateOf(values),
      }
    }
    case 'SUBSTRING_INDEX': {
      arity(3)
      const values = args()
      return call(
        'fr_substring_index',
        values.map((value, i) => (i === 2 ? numeric(value) : value)),
        text(values[0]!.type.length, values[0]),
      )
    }
    case 'QUOTE':
      arity(1)
      return call('fr_quote', args(), stringType(64))
    case 'MD5':
      arity(1)
      return call('fr_md5', args(), stringType(32))
    case 'SHA':
    case 'SHA1':
      arity(1)
      return call('fr_sha1', args(), stringType(40))
    case 'SHA2': {
      arity(2)
      const values = args()
      return call('fr_sha2', [values[0]!, numeric(values[1]!)], stringType(128))
    }
    case 'CRC32':
      arity(1)
      return call('fr_crc32', args(), integerType(10, true))
    case 'TO_BASE64':
      arity(1)
      return call('fr_to_base64', args(), LONGTEXT_TYPE)
    case 'FROM_BASE64':
      arity(1)
      return call('fr_from_base64', args(), { ...LONGTEXT_TYPE, binary: true })
    case 'UUID':
      arity(0)
      return { sql: 'fr_uuid()', type: stringType(36) }
    case 'UUID_SHORT':
      arity(0)
      return { sql: 'fr_uuid_short()', type: integerType(21, true) }
    case 'SYS_GUID':
      arity(0)
      return { sql: `upper(replace(fr_uuid(), '-', ''))`, type: stringType(32) }
    case 'BIN':
    case 'OCT':
      arity(1)
      return call(`fr_${name.toLowerCase()}`, args().map(numeric), stringType(64))
    case 'CONV': {
      arity(3)
      const values = args()
      return call('fr_conv', [values[0]!, numeric(values[1]!), numeric(values[2]!)], stringType(64))
    }
    case 'INET_ATON':
      arity(1)
      return call('fr_inet_aton', args(), integerType(21, true))
    case 'INET_NTOA':
      arity(1)
      return call('fr_inet_ntoa', args().map(numeric), stringType(15))
    case 'REGEXP_REPLACE': {
      arity(3)
      const values = args()
      return {
        sql: `fr_regexp_replace(${values.map((value) => value.sql).join(', ')}, ${ci(values[0]!, values[1]!)})`,
        type: LONGTEXT_TYPE,
        ...aggregateOf(values),
      }
    }
    case 'REGEXP_SUBSTR': {
      arity(2)
      const values = args()
      return {
        sql: `fr_regexp_substr(${values.map((value) => value.sql).join(', ')}, ${ci(...values)})`,
        type: LONGTEXT_TYPE,
        ...aggregateOf(values),
      }
    }
    case 'REGEXP_INSTR': {
      arity(2)
      const values = args()
      return {
        sql: `fr_regexp_instr(${values.map((value) => value.sql).join(', ')}, ${ci(...values)})`,
        type: integerType(11),
        ...aggregateOf(values),
      }
    }
    case 'CONVERT_USING':
      return compile(expr.args[0]!)
    case 'CHARSET': {
      arity(1)
      const [value] = args() as [Compiled]
      return {
        sql: compiler.bind(
          value.type.binary === true ? 'binary' : isString(value.type) ? 'utf8mb4' : 'binary',
        ),
        type: stringType(64),
      }
    }
    case 'COLLATION': {
      arity(1)
      const [value] = args() as [Compiled]
      const collation =
        value.type.binary === true || !isString(value.type)
          ? 'binary'
          : value.type.caseSensitive === true
            ? 'utf8mb4_bin'
            : 'utf8mb4_general_ci'
      return { sql: compiler.bind(collation), type: stringType(64) }
    }

    // Numbers
    case 'ABS': {
      arity(1)
      const [value] = args() as [Compiled]
      return {
        sql: `fr_math('abs', ${compiler.numeric(value)})`,
        type: numericOf(compiler.numericType(value)),
        ...aggregateOf([value]),
      }
    }
    case 'CEIL':
    case 'CEILING':
    case 'FLOOR': {
      arity(1)
      const [value] = args() as [Compiled]
      const type = numericOf(compiler.numericType(value))
      return {
        sql: `fr_math('${name === 'FLOOR' ? 'floor' : 'ceil'}', ${compiler.numeric(value)})`,
        type: isReal(type) ? DOUBLE_TYPE : integerType(Math.max(type.length, 1)),
        ...aggregateOf([value]),
      }
    }
    case 'ROUND':
    case 'TRUNCATE': {
      if (name === 'ROUND') arity(1, 2)
      else arity(2)
      const values = args()
      const [value, digits] = values as [Compiled, Compiled | undefined]
      const type = numericOf(compiler.numericType(value))
      const places =
        digits?.constant !== undefined && typeof digits.constant === 'number'
          ? digits.constant
          : digits === undefined
            ? 0
            : undefined
      let result: Type
      if (isReal(type)) result = DOUBLE_TYPE
      else if (isInteger(type))
        result = places !== undefined && places >= 0 ? type : integerType(type.length)
      else
        result =
          places === undefined
            ? type
            : places <= 0
              ? integerType(Math.max(1, type.length))
              : decimalType(Math.max(1, type.length), Math.min(places, 38))
      const exact = isReal(type) ? 0 : 1
      const sql =
        name === 'ROUND'
          ? `fr_round(${compiler.numeric(value)}, ${digits === undefined ? 0 : compiler.numeric(digits)}, ${exact})`
          : `fr_truncate(${compiler.numeric(value)}, ${compiler.numeric(digits!)})`
      return { sql, type: result, ...aggregateOf(values) }
    }
    case 'MOD': {
      arity(2)
      const [a, b] = args() as [Compiled, Compiled]
      return {
        sql: `fr_mod(${compiler.numeric(a)}, ${compiler.numeric(b)})`,
        type: numericOf(compiler.numericType(a)),
        ...aggregateOf([a, b]),
      }
    }
    case 'POW':
    case 'POWER':
      arity(2)
      return call('fr_math', args().map(numeric), DOUBLE_TYPE, ["'pow'"])
    case 'SQRT':
    case 'EXP':
    case 'LN':
    case 'LOG2':
    case 'LOG10':
    case 'SIN':
    case 'COS':
    case 'TAN':
    case 'ASIN':
    case 'ACOS':
    case 'COT':
    case 'DEGREES':
    case 'RADIANS':
      arity(1)
      return call('fr_math', args().map(numeric), DOUBLE_TYPE, [`'${name.toLowerCase()}'`])
    case 'LOG':
      arity(1, 2)
      return call('fr_math', args().map(numeric), DOUBLE_TYPE, ["'log'"])
    case 'ATAN':
    case 'ATAN2':
      arity(name === 'ATAN' ? 1 : 2, 2)
      return call('fr_math', args().map(numeric), DOUBLE_TYPE, ["'atan'"])
    case 'SIGN':
      arity(1)
      return call('fr_math', args().map(numeric), integerType(2), ["'sign'"])
    case 'PI':
      arity(0)
      return { sql: `fr_math('pi')`, type: { ...DOUBLE_TYPE, length: 8, decimals: 6 } }
    case 'RAND':
      arity(0, 1)
      return { sql: 'fr_rand()', type: DOUBLE_TYPE }

    // Dates and times
    case 'NOW':
    case 'SYSDATE':
    case 'UTC_TIMESTAMP': {
      arity(0, 1)
      const fsp = fspOf(expr)
      return { sql: `fr_now(${fsp}, ${name === 'UTC_TIMESTAMP' ? 1 : 0})`, type: datetimeType(fsp) }
    }
    case 'CURDATE':
    case 'UTC_DATE':
      arity(0)
      return { sql: `fr_curdate(${name === 'UTC_DATE' ? 1 : 0})`, type: DATE_TYPE }
    case 'CURTIME':
    case 'UTC_TIME': {
      arity(0, 1)
      const fsp = fspOf(expr)
      return { sql: `fr_curtime(${fsp}, ${name === 'UTC_TIME' ? 1 : 0})`, type: timeType(fsp) }
    }
    case 'UNIX_TIMESTAMP': {
      arity(0, 1)
      if (expr.args.length === 0) return { sql: 'fr_unix_timestamp()', type: integerType(11, true) }
      const [value] = args() as [Compiled]
      // Strings written in the SQL give as many digits of fractions as they have, others give six.
      const constant = typeof value.constant === 'string' ? value.constant : undefined
      const fsp = isDateType(value.type)
        ? value.type.decimals
        : constant !== undefined
          ? Math.min(/\.(\d+)/.exec(constant)?.[1]?.length ?? 0, 6)
          : isString(value.type)
            ? 6
            : 0
      return {
        sql: `fr_unix_timestamp(${value.sql})`,
        type: fsp > 0 ? decimalType(11 + fsp, fsp) : integerType(11, true),
        ...aggregateOf([value]),
      }
    }
    case 'FROM_UNIXTIME': {
      arity(1, 2)
      const values = args()
      const [seconds, format] = values as [Compiled, Compiled | undefined]
      const fsp = isDecimal(seconds.type)
        ? Math.min(seconds.type.decimals, 6)
        : isReal(seconds.type)
          ? 6
          : 0
      if (format !== undefined)
        return {
          sql: `fr_from_unixtime(${compiler.numeric(seconds)}, ${fsp}, ${format.sql})`,
          type: stringType(64),
          ...aggregateOf(values),
        }
      return {
        sql: `fr_from_unixtime(${compiler.numeric(seconds)}, ${fsp})`,
        type: datetimeType(fsp),
        ...aggregateOf(values),
      }
    }
    case 'DATE': {
      arity(1)
      const [value] = args() as [Compiled]
      return { sql: `fr_datepart('DATE', ${value.sql})`, type: DATE_TYPE, ...aggregateOf([value]) }
    }
    case 'TIME': {
      arity(1)
      const [value] = args() as [Compiled]
      const fsp =
        value.type.decimals > 0 && value.type.decimals <= 6
          ? value.type.decimals
          : isString(value.type)
            ? 6
            : 0
      return {
        sql: `fr_cast_temporal(${value.sql}, 'time', ${fsp})`,
        type: timeType(fsp),
        ...aggregateOf([value]),
      }
    }
    case 'TIMESTAMP': {
      arity(1, 2)
      const values = args()
      return call(
        'fr_timestamp',
        values,
        datetimeType(
          values.some(
            (value) =>
              (value.type.decimals > 0 && value.type.decimals <= 6) || isString(value.type),
          )
            ? 6
            : 0,
        ),
      )
    }
    case 'YEAR':
    case 'MONTH':
    case 'DAY':
    case 'DAYOFMONTH':
    case 'HOUR':
    case 'MINUTE':
    case 'SECOND':
    case 'MICROSECOND':
    case 'QUARTER':
    case 'DAYOFWEEK':
    case 'WEEKDAY':
    case 'DAYOFYEAR':
    case 'WEEKOFYEAR':
    case 'TO_DAYS':
    case 'TO_SECONDS':
    case 'TIME_TO_SEC': {
      arity(1)
      const [value] = args() as [Compiled]
      const part = name === 'DAYOFMONTH' ? 'DAY' : name
      const type =
        name === 'YEAR'
          ? YEAR_TYPE
          : name === 'TIME_TO_SEC'
            ? value.type.decimals > 0 && value.type.decimals <= 6
              ? decimalType(17, value.type.decimals)
              : integerType(10)
            : integerType(name === 'TO_DAYS' || name === 'TO_SECONDS' ? 21 : 3)
      return { sql: `fr_datepart('${part}', ${value.sql})`, type, ...aggregateOf([value]) }
    }
    case 'WEEK':
    case 'YEARWEEK': {
      arity(1, 2)
      const values = args()
      const [value, mode] = values as [Compiled, Compiled | undefined]
      return {
        sql: `fr_datepart('${name}', ${value.sql}, ${mode === undefined ? 0 : compiler.numeric(mode)})`,
        type: integerType(name === 'WEEK' ? 2 : 6),
        ...aggregateOf(values),
      }
    }
    case 'DAYNAME':
    case 'MONTHNAME':
      arity(1)
      return { ...call('fr_datepart', args(), stringType(9), [`'${name}'`]) }
    case 'LAST_DAY':
      arity(1)
      return call('fr_datepart', args(), DATE_TYPE, ["'LAST_DAY'"])
    case 'DATE_ADD':
    case 'ADDDATE':
    case 'DATE_SUB':
    case 'SUBDATE': {
      arity(2)
      const [dateExpr, intervalExpr] = expr.args as [Expression, Expression]
      const date = compile(dateExpr)
      const sign = name === 'DATE_SUB' || name === 'SUBDATE' ? -1 : 1
      if (intervalExpr.kind === 'interval') {
        return compiler.dateAdd(date, compile(intervalExpr.value), intervalExpr.unit, sign)
      }
      // ADDDATE(date, days) adds days.
      return compiler.dateAdd(date, compile(intervalExpr), 'DAY', sign)
    }
    case 'TIMESTAMPADD': {
      arity(3)
      const [unitExpr, amountExpr, dateExpr] = expr.args as [Expression, Expression, Expression]
      const unit = unitExpr.kind === 'string' ? (unitExpr.text as IntervalUnit) : 'DAY'
      return compiler.dateAdd(compile(dateExpr), compile(amountExpr), unit, 1)
    }
    case 'TIMESTAMPDIFF': {
      arity(3)
      const [unitExpr, ...rest] = expr.args as [Expression, Expression, Expression]
      const unit = unitExpr.kind === 'string' ? unitExpr.text : 'DAY'
      const values = rest.map(compile)
      return call('fr_timestampdiff', values, integerType(21), [`'${unit}'`])
    }
    case 'DATEDIFF':
      arity(2)
      return call('fr_datediff', args(), integerType(11))
    case 'TIMEDIFF':
      arity(2)
      return call('fr_timediff', args(), timeType(6))
    case 'ADDTIME':
    case 'SUBTIME': {
      arity(2)
      const values = args()
      const type = isDateType(values[0]!.type)
        ? datetimeType(6)
        : values[0]!.type.field === 'TIME'
          ? timeType(6)
          : stringType(29)
      return {
        sql: `fr_addtime(${values[0]!.sql}, ${values[1]!.sql}, ${name === 'SUBTIME' ? -1 : 1})`,
        type,
        ...aggregateOf(values),
      }
    }
    case 'DATE_FORMAT':
      arity(2, 3)
      return call('fr_date_format', args().slice(0, 2), stringType(64))
    case 'TIME_FORMAT':
      arity(2)
      return call('fr_time_format', args(), stringType(64))
    case 'STR_TO_DATE': {
      arity(2)
      const values = args()
      const format = values[1]!.constant
      let type: Type = datetimeType(6)
      if (typeof format === 'string') {
        const date = /%[YyMmbcdDejaWUuVvXx]/.test(format)
        const time = /%[HhIiklSsTrfp]/.test(format)
        type =
          date && !time
            ? DATE_TYPE
            : time && !date
              ? timeType(/%f/.test(format) ? 6 : 0)
              : datetimeType(/%f/.test(format) ? 6 : 0)
      }
      return call('fr_str_to_date', values, type)
    }
    case 'CONVERT_TZ':
      arity(3)
      return call('fr_convert_tz', args(), datetimeType(6))
    case 'EXTRACT': {
      arity(2)
      const [unitExpr, value] = expr.args as [Expression, Expression]
      const unit = unitExpr.kind === 'string' ? unitExpr.text : 'DAY'
      return call('fr_extract', [compile(value)], integerType(21), [`'${unit}'`])
    }
    case 'FROM_DAYS':
      arity(1)
      return call('fr_from_days', args().map(numeric), DATE_TYPE)
    case 'MAKEDATE':
      arity(2)
      return call('fr_makedate', args().map(numeric), DATE_TYPE)
    case 'MAKETIME':
      arity(3)
      return call('fr_maketime', args().map(numeric), timeType(6))
    case 'SEC_TO_TIME':
      arity(1)
      return call('fr_sec_to_time', args().map(numeric), timeType(6))
    case 'PERIOD_ADD':
    case 'PERIOD_DIFF':
      arity(2)
      return call('fr_period', args().map(numeric), integerType(6), [
        `'${name === 'PERIOD_ADD' ? 'add' : 'diff'}'`,
      ])

    // JSON
    case 'JSON_VALID':
      arity(1)
      return call('fr_json_valid', args(), integerType(1))
    case 'JSON_EXTRACT':
      if (expr.args.length < 2) throw parameterCount(written)
      return call('fr_json_extract', args(), LONGTEXT_TYPE, [], true)
    case 'JSON_UNQUOTE':
      arity(1)
      return call('fr_json_unquote', args(), LONGTEXT_TYPE)
    case 'JSON_VALUE':
      arity(2)
      return call('fr_json_value', args(), LONGTEXT_TYPE)
    case 'JSON_QUERY':
      arity(2)
      return call('fr_json_query', args(), LONGTEXT_TYPE, [], true)
    case 'JSON_EXISTS':
      arity(2)
      return call('fr_json_exists', args(), integerType(1))
    case 'JSON_SET':
    case 'JSON_INSERT':
    case 'JSON_REPLACE':
    case 'JSON_ARRAY_APPEND':
    case 'JSON_ARRAY_INSERT': {
      if (expr.args.length < 3 || expr.args.length % 2 === 0) throw parameterCount(written)
      const [document, ...pairs] = args() as [Compiled, ...Compiled[]]
      const values = pairs.filter((_, i) => i % 2 === 1)
      return {
        sql: `fr_${name.toLowerCase()}(${document.sql}, '${jsonFlags(values)}', ${pairs.map((pair) => pair.sql).join(', ')})`,
        type: LONGTEXT_TYPE,
        json: true,
        ...aggregateOf([document, ...pairs]),
      }
    }
    case 'JSON_REMOVE':
      if (expr.args.length < 2) throw parameterCount(written)
      return call('fr_json_remove', args(), LONGTEXT_TYPE, [], true)
    case 'JSON_OBJECT': {
      if (expr.args.length % 2 !== 0) throw parameterCount(written)
      const values = args()
      return {
        sql: `fr_json_object('${jsonFlags(values.filter((_, i) => i % 2 === 1))}'${values.map((value) => `, ${value.sql}`).join('')})`,
        type: LONGTEXT_TYPE,
        json: true,
        ...aggregateOf(values),
      }
    }
    case 'JSON_ARRAY': {
      const values = args()
      return {
        sql: `fr_json_array('${jsonFlags(values)}'${values.map((value) => `, ${value.sql}`).join('')})`,
        type: LONGTEXT_TYPE,
        json: true,
        ...aggregateOf(values),
      }
    }
    case 'JSON_QUOTE':
      arity(1)
      return call('fr_json_quote', args(), LONGTEXT_TYPE, [], true)
    case 'JSON_CONTAINS':
      arity(2, 3)
      return call('fr_json_contains', args(), integerType(1))
    case 'JSON_CONTAINS_PATH':
      if (expr.args.length < 3) throw parameterCount(written)
      return call('fr_json_contains_path', args(), integerType(1))
    case 'JSON_KEYS':
      arity(1, 2)
      return call('fr_json_keys', args(), LONGTEXT_TYPE, [], true)
    case 'JSON_LENGTH':
      arity(1, 2)
      return call('fr_json_length', args(), integerType(10))
    case 'JSON_DEPTH':
      arity(1)
      return call('fr_json_depth', args(), integerType(10))
    case 'JSON_TYPE':
      arity(1)
      return call('fr_json_type', args(), stringType(12))
    case 'JSON_MERGE':
    case 'JSON_MERGE_PRESERVE':
    case 'JSON_MERGE_PATCH':
      if (expr.args.length < 2) throw parameterCount(written)
      return call(
        'fr_json_merge',
        args(),
        LONGTEXT_TYPE,
        [`'${name === 'JSON_MERGE_PATCH' ? 'patch' : 'preserve'}'`],
        true,
      )
    case 'JSON_SEARCH':
      if (expr.args.length < 3) throw parameterCount(written)
      return call('fr_json_search', args(), LONGTEXT_TYPE, [], true)
    case 'JSON_COMPACT':
    case 'JSON_DETAILED':
    case 'JSON_PRETTY':
    case 'JSON_LOOSE': {
      arity(1)
      const kind =
        name === 'JSON_COMPACT' ? 'compact' : name === 'JSON_LOOSE' ? 'loose' : 'detailed'
      return call('fr_json_format', args(), LONGTEXT_TYPE, [`'${kind}'`], true)
    }

    // The server and the session
    case 'DATABASE':
      arity(0)
      return { sql: 'fr_database()', type: stringType(64) }
    case 'VERSION':
      arity(0)
      return { sql: 'fr_version()', type: stringType(64) }
    case 'USER':
    case 'CURRENT_USER':
    case 'SESSION_USER':
    case 'SYSTEM_USER':
      arity(0)
      return { sql: 'fr_user()', type: stringType(141) }
    case 'CONNECTION_ID':
      arity(0)
      return { sql: 'fr_connection_id()', type: integerType(10, true) }
    case 'LAST_INSERT_ID': {
      arity(0, 1)
      const values = args()
      return {
        sql: `fr_last_insert_id(${values.map((value) => compiler.numeric(value)).join(', ')})`,
        type: integerType(21, true),
        ...aggregateOf(values),
      }
    }
    case 'ROW_COUNT':
      arity(0)
      return { sql: 'fr_row_count()', type: integerType(21) }
    case 'FOUND_ROWS':
      arity(0)
      return { sql: 'fr_found_rows()', type: integerType(21) }
    case 'SLEEP':
      arity(1)
      return call('fr_sleep', args(), integerType(21))
    case 'GET_LOCK':
      arity(2)
      return call('fr_lock', args(), integerType(1))
    case 'RELEASE_LOCK':
    case 'IS_FREE_LOCK':
      arity(1)
      return call('fr_lock', args(), integerType(1))
    case 'IS_USED_LOCK':
      arity(1)
      return call('fr_is_used_lock', args(), integerType(10, true))
    case 'RELEASE_ALL_LOCKS':
      arity(0)
      return { sql: '0', type: integerType(10, true) }
    case 'NOW_UTC':
      return { sql: 'fr_now(0, 1)', type: datetimeType(0) }
    default:
      throw new SqlError(
        1305,
        '42000',
        `FUNCTION ${compiler.catalog.schema}.${written} does not exist`,
      )
  }
}

/** The digits of fractions of seconds that NOW(fsp) and the like are given. */
function fspOf(expr: Call): number {
  const [arg] = expr.args
  if (arg === undefined) return 0
  if (arg.kind !== 'number' || !/^\d+$/.test(arg.text)) {
    throw new SqlError(1064, '42000', `Incorrect arguments to ${expr.name}`)
  }
  const fsp = Number(arg.text)
  if (fsp > 6)
    throw new SqlError(
      1426,
      '42000',
      `Too big precision ${fsp} specified for '${expr.name.toLowerCase()}'. Maximum is 6`,
    )
  return fsp
}

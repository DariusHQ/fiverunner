import type {
  AlterAction,
  AlterTable,
  ColumnDefinition,
  ColumnPosition,
  CreateTable,
  DataType,
  Expression,
  KeyPart,
  Reference,
  ReferenceAction,
  Select,
  Statement,
  TableConstraint,
  TableName,
  TableOptions,
} from './ast.ts'
import { SqlError } from './lexer.ts'
import { unsupported, type Parser } from './parser.ts'

/** The names of types that are others by other names, and what those are. */
const SYNONYMS: Readonly<Record<string, string>> = {
  INT1: 'TINYINT',
  INT2: 'SMALLINT',
  INT3: 'MEDIUMINT',
  MIDDLEINT: 'MEDIUMINT',
  INT4: 'INT',
  INTEGER: 'INT',
  INT8: 'BIGINT',
  DEC: 'DECIMAL',
  NUMERIC: 'DECIMAL',
  FIXED: 'DECIMAL',
  REAL: 'DOUBLE',
  FLOAT8: 'DOUBLE',
  FLOAT4: 'FLOAT',
  CHARACTER: 'CHAR',
  NCHAR: 'CHAR',
  NVARCHAR: 'VARCHAR',
  VARCHARACTER: 'VARCHAR',
}

/** The types of integers. */
export const INTEGER_TYPES: ReadonlySet<string> = new Set([
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'INT',
  'BIGINT',
])

/** The types whose length is that of strings. */
const STRING_TYPES: ReadonlySet<string> = new Set([
  'CHAR',
  'VARCHAR',
  'BINARY',
  'VARBINARY',
  'TINYTEXT',
  'TEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  'TINYBLOB',
  'BLOB',
  'MEDIUMBLOB',
  'LONGBLOB',
  'ENUM',
  'SET',
  'JSON',
])

/** The types that MariaDB has and FiveRunner's database stores as others, as it has no geometry. */
const UNSUPPORTED_TYPES: ReadonlySet<string> = new Set([
  'GEOMETRY',
  'POINT',
  'LINESTRING',
  'POLYGON',
  'MULTIPOINT',
  'MULTILINESTRING',
  'MULTIPOLYGON',
  'GEOMETRYCOLLECTION',
])

/** Reads a type of columns, as a column definition gives it. */
export function dataType(p: Parser): DataType {
  const token = p.next()
  if (token.kind !== 'word') p.fail(token)
  let name = token.text.toUpperCase()
  let unsigned = false
  let zerofill = false
  let length: number | undefined
  let scale: number | undefined
  let values: string[] | undefined
  let charset: string | undefined
  let collation: string | undefined
  if (name === 'NATIONAL') {
    const next = p.next()
    if (next.kind !== 'word') p.fail(next)
    name = next.text.toUpperCase()
  }
  if (name === 'BOOL' || name === 'BOOLEAN') return { name: 'TINYINT', length: 1 }
  if (name === 'SERIAL') return { name: 'BIGINT', unsigned: true }
  if (name === 'DOUBLE') p.acceptWord('PRECISION')
  if (name === 'LONG') {
    // LONG, LONG VARCHAR and LONG VARBINARY are MEDIUMTEXT and MEDIUMBLOB.
    if (p.acceptWord('VARBINARY')) name = 'MEDIUMBLOB'
    else {
      p.acceptOneOf('VARCHAR', 'VARCHARACTER')
      name = 'MEDIUMTEXT'
    }
  }
  if ((name === 'CHAR' || name === 'CHARACTER') && p.acceptWord('VARYING')) name = 'VARCHAR'
  name = SYNONYMS[name] ?? name
  if (UNSUPPORTED_TYPES.has(name)) throw unsupported(`the type ${name}`)
  const known =
    INTEGER_TYPES.has(name) ||
    STRING_TYPES.has(name) ||
    [
      'DECIMAL',
      'FLOAT',
      'DOUBLE',
      'BIT',
      'DATE',
      'TIME',
      'DATETIME',
      'TIMESTAMP',
      'YEAR',
      'UUID',
      'INET4',
      'INET6',
    ].includes(name)
  if (!known) p.fail(token)
  if (name === 'ENUM' || name === 'SET') {
    p.expectOp('(')
    values = [p.string()]
    while (p.acceptOp(',')) values.push(p.string())
    p.expectOp(')')
  } else if (p.acceptOp('(')) {
    length = p.integer()
    if (p.acceptOp(',')) scale = p.integer()
    p.expectOp(')')
  }
  if (name === 'VARCHAR' || name === 'VARBINARY') {
    if (length === undefined) p.fail()
  }
  if (name === 'FLOAT' && length !== undefined && scale === undefined) {
    // FLOAT(p) is a FLOAT up to 24 bits of precision, and a DOUBLE after.
    if (length > 24) name = 'DOUBLE'
    length = undefined
  }
  for (;;) {
    if (p.acceptWord('UNSIGNED')) unsigned = true
    else if (p.acceptWord('SIGNED')) unsigned = false
    else if (p.acceptWord('ZEROFILL')) {
      zerofill = true
      unsigned = true
    } else if (p.acceptWord('CHARACTER', 'SET') || p.acceptWord('CHARSET'))
      charset = p.nameOrString()
    else if (p.acceptWord('ASCII')) charset = 'latin1'
    else if (p.acceptWord('UNICODE')) charset = 'ucs2'
    else if (p.acceptWord('BYTE')) charset = 'binary'
    else if (p.acceptWord('COLLATE')) collation = p.nameOrString()
    else if (p.isWord('BINARY') && !p.isOp('(', 1)) {
      p.next()
      // CHAR(n) BINARY takes the binary collation of its character set.
      collation = collation ?? 'utf8mb4_bin'
    } else break
  }
  return {
    name,
    ...(length === undefined ? {} : { length }),
    ...(scale === undefined ? {} : { scale }),
    ...(unsigned ? { unsigned } : {}),
    ...(zerofill ? { zerofill } : {}),
    ...(values === undefined ? {} : { values }),
    ...(charset === undefined ? {} : { charset }),
    ...(collation === undefined ? {} : { collation }),
  }
}

/** Reads a column's definition, from its name. */
function columnDefinition(p: Parser): ColumnDefinition {
  const name = p.name()
  // SERIAL is BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE.
  const serial = p.isWord('SERIAL')
  const type = dataType(p)
  let nullable: boolean | undefined
  let defaultValue: Expression | undefined
  let onUpdate: Expression | undefined
  let autoIncrement = false
  let key: 'PRIMARY' | 'UNIQUE' | undefined
  let comment: string | undefined
  let check: Expression | undefined
  let references: Reference | undefined
  let generated: { expr: Expression; stored: boolean } | undefined
  let collation = type.collation
  let charset = type.charset
  for (;;) {
    if (p.acceptWord('NOT', 'NULL')) nullable = false
    else if (p.acceptWord('NULL')) nullable = true
    else if (p.acceptWord('DEFAULT')) defaultValue = defaultExpression(p)
    else if (p.acceptWord('ON', 'UPDATE')) onUpdate = defaultExpression(p)
    else if (p.acceptWord('AUTO_INCREMENT')) autoIncrement = true
    else if (p.acceptWord('UNIQUE')) {
      p.acceptWord('KEY')
      key = key ?? 'UNIQUE'
    } else if (p.acceptWord('PRIMARY', 'KEY') || p.acceptWord('KEY')) key = 'PRIMARY'
    else if (p.acceptWord('COMMENT')) comment = p.string()
    else if (p.acceptWord('COLLATE')) collation = p.nameOrString()
    else if (p.acceptWord('CHARACTER', 'SET') || p.acceptWord('CHARSET')) charset = p.nameOrString()
    else if (p.isWord('CONSTRAINT') || p.isWord('CHECK')) {
      if (p.acceptWord('CONSTRAINT') && !p.isWord('CHECK')) p.name()
      p.expectWord('CHECK')
      p.expectOp('(')
      check = p.expression()
      p.expectOp(')')
    } else if (p.isWord('REFERENCES')) references = reference(p)
    else if (p.isWord('GENERATED') || p.isWord('AS')) {
      if (p.acceptWord('GENERATED')) p.expectWord('ALWAYS')
      p.expectWord('AS')
      p.expectOp('(')
      const expr = p.expression()
      p.expectOp(')')
      const storage = p.acceptOneOf('VIRTUAL', 'PERSISTENT', 'STORED')
      generated = { expr, stored: storage === 'PERSISTENT' || storage === 'STORED' }
    } else if (p.acceptOneOf('INVISIBLE', 'VISIBLE') !== undefined) {
      // Columns that SELECT * leaves out are not emulated.
    } else if (p.acceptWord('COLUMN_FORMAT') || p.acceptWord('STORAGE')) p.next()
    else if (p.acceptWord('SERIAL', 'DEFAULT', 'VALUE')) {
      autoIncrement = true
      nullable = false
      key = key ?? 'UNIQUE'
    } else break
  }
  if (serial) {
    autoIncrement = true
    nullable = false
    key = key ?? 'UNIQUE'
  }
  const finalType: DataType = {
    ...type,
    ...(charset === undefined ? {} : { charset }),
    ...(collation === undefined ? {} : { collation }),
  }
  return {
    name,
    type: finalType,
    ...(nullable === undefined ? {} : { nullable }),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
    autoIncrement,
    ...(key === undefined ? {} : { key }),
    ...(comment === undefined ? {} : { comment }),
    ...(check === undefined ? {} : { check }),
    ...(references === undefined ? {} : { references }),
    ...(generated === undefined ? {} : { generated }),
  }
}

/**
 * Reads the default of a column: a literal, maybe with a sign, a function
 * such as CURRENT_TIMESTAMP, or any expression in parentheses.
 */
function defaultExpression(p: Parser): Expression {
  const start = p.position
  const sign = p.isOp('-') ? '-' : p.isOp('+') ? '+' : undefined
  if (sign !== undefined) {
    p.next()
    const operand = defaultExpression(p)
    return { kind: 'unary', op: sign, operand, start, end: operand.end }
  }
  if (p.isOp('(')) {
    p.next()
    const expr = p.expression()
    p.expectOp(')')
    return { ...expr, start, end: p.last }
  }
  const token = p.peek()
  if (
    token.kind === 'word' &&
    !['NULL', 'TRUE', 'FALSE'].includes(token.text.toUpperCase()) &&
    !p.isOp('(', 1)
  ) {
    // CURRENT_TIMESTAMP and the like, which need no parentheses.
    const upper = token.text.toUpperCase()
    if (
      ![
        'CURRENT_TIMESTAMP',
        'LOCALTIME',
        'LOCALTIMESTAMP',
        'CURRENT_DATE',
        'CURRENT_TIME',
        'NOW',
      ].includes(upper)
    ) {
      p.fail()
    }
  }
  return p.primaryExpression()
}

/** Reads REFERENCES table (columns), with what it does ON DELETE and ON UPDATE. */
function reference(p: Parser): Reference {
  p.expectWord('REFERENCES')
  const table = p.tableName()
  const columns = p.nameList()
  if (p.acceptWord('MATCH')) p.acceptOneOf('FULL', 'PARTIAL', 'SIMPLE')
  let onDelete: ReferenceAction | undefined
  let onUpdate: ReferenceAction | undefined
  for (;;) {
    if (p.acceptWord('ON', 'DELETE')) onDelete = referenceAction(p)
    else if (p.acceptWord('ON', 'UPDATE')) onUpdate = referenceAction(p)
    else break
  }
  return {
    table,
    columns,
    ...(onDelete === undefined ? {} : { onDelete }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
  }
}

function referenceAction(p: Parser): ReferenceAction {
  if (p.acceptWord('RESTRICT')) return 'RESTRICT'
  if (p.acceptWord('CASCADE')) return 'CASCADE'
  if (p.acceptWord('SET', 'NULL')) return 'SET NULL'
  if (p.acceptWord('SET', 'DEFAULT')) return 'SET DEFAULT'
  if (p.acceptWord('NO', 'ACTION')) return 'NO ACTION'
  p.fail()
}

/** Reads the columns of a key in parentheses, each maybe with the length of a prefix and an order. */
function keyParts(p: Parser): KeyPart[] {
  p.expectOp('(')
  const parts: KeyPart[] = []
  do {
    if (p.isOp('(')) throw unsupported('keys of expressions')
    const column = p.name()
    let length: number | undefined
    if (p.acceptOp('(')) {
      length = p.integer()
      p.expectOp(')')
    }
    const order = p.acceptOneOf('ASC', 'DESC')
    parts.push({
      column,
      ...(length === undefined ? {} : { length }),
      descending: order === 'DESC',
    })
  } while (p.acceptOp(','))
  p.expectOp(')')
  return parts
}

/** Reads USING BTREE, COMMENT and the other options of indexes, which change nothing here. */
function indexOptions(p: Parser): void {
  for (;;) {
    if (p.acceptWord('USING')) {
      if (p.acceptOneOf('BTREE', 'HASH', 'RTREE') === undefined) p.fail()
    } else if (p.acceptWord('KEY_BLOCK_SIZE')) {
      p.optionalEquals()
      p.integer()
    } else if (p.acceptWord('COMMENT')) p.string()
    else if (p.acceptWord('WITH', 'PARSER')) p.name()
    else if (p.acceptOneOf('VISIBLE', 'INVISIBLE', 'IGNORED') !== undefined) {
      // Options of the optimizer.
    } else if (p.acceptWord('NOT', 'IGNORED')) {
      // As above.
    } else if (p.acceptWord('CLUSTERING')) {
      p.optionalEquals()
      p.next()
    } else return
  }
}

/** Reads the name of an index, if one comes before its columns or USING. */
function optionalIndexName(p: Parser): string | undefined {
  return p.isName() && !p.isWord('USING') ? p.name() : undefined
}

/**
 * Reads a constraint or key of a table, as CREATE TABLE and ALTER TABLE
 * ... ADD give them, if one comes next: PRIMARY KEY, UNIQUE, INDEX or KEY,
 * FULLTEXT, SPATIAL, FOREIGN KEY and CHECK, which CONSTRAINT may name.
 */
function tableConstraint(
  p: Parser,
): { constraint: TableConstraint; ifNotExists: boolean } | undefined {
  let name: string | undefined
  if (p.acceptWord('CONSTRAINT')) {
    if (!p.isWord('PRIMARY') && !p.isWord('UNIQUE') && !p.isWord('FOREIGN') && !p.isWord('CHECK'))
      name = p.name()
    if (!p.isWord('PRIMARY') && !p.isWord('UNIQUE') && !p.isWord('FOREIGN') && !p.isWord('CHECK'))
      p.fail()
  }
  const ifNotExists = (): boolean => p.acceptWord('IF', 'NOT', 'EXISTS')
  if (p.acceptWord('PRIMARY', 'KEY')) {
    indexOptions(p)
    const parts = keyParts(p)
    indexOptions(p)
    return {
      constraint: { kind: 'PRIMARY', ...(name === undefined ? {} : { name }), parts },
      ifNotExists: false,
    }
  }
  if (p.acceptWord('UNIQUE')) {
    p.acceptOneOf('INDEX', 'KEY')
    const exists = ifNotExists()
    const indexName = optionalIndexName(p) ?? name
    indexOptions(p)
    const parts = keyParts(p)
    indexOptions(p)
    return {
      constraint: {
        kind: 'UNIQUE',
        ...(indexName === undefined ? {} : { name: indexName }),
        parts,
      },
      ifNotExists: exists,
    }
  }
  if (p.acceptWord('FOREIGN', 'KEY')) {
    const exists = ifNotExists()
    const keyName = optionalIndexName(p) ?? name
    const columns = p.nameList()
    const references = reference(p)
    return {
      constraint: {
        kind: 'FOREIGN',
        ...(keyName === undefined ? {} : { name: keyName }),
        columns,
        references,
      },
      ifNotExists: exists,
    }
  }
  if (p.acceptWord('CHECK')) {
    p.expectOp('(')
    const expr = p.expression()
    p.expectOp(')')
    return {
      constraint: { kind: 'CHECK', ...(name === undefined ? {} : { name }), expr },
      ifNotExists: false,
    }
  }
  if (name !== undefined) p.fail()
  const kind = p.isWord('FULLTEXT')
    ? 'FULLTEXT'
    : p.isWord('SPATIAL')
      ? 'SPATIAL'
      : p.isWord('INDEX') || p.isWord('KEY')
        ? 'INDEX'
        : undefined
  if (kind === undefined) return undefined
  p.next()
  if (kind !== 'INDEX') p.acceptOneOf('INDEX', 'KEY')
  const exists = ifNotExists()
  const indexName = optionalIndexName(p)
  indexOptions(p)
  const parts = keyParts(p)
  indexOptions(p)
  return {
    constraint: { kind, ...(indexName === undefined ? {} : { name: indexName }), parts },
    ifNotExists: exists,
  }
}

/**
 * Reads the options of a table, such as ENGINE=InnoDB, which commas may
 * separate after CREATE TABLE, where ALTER TABLE separates its actions with
 * them.
 */
function tableOptions(p: Parser, commas: boolean): TableOptions {
  const options: { -readonly [K in keyof TableOptions]: TableOptions[K] } = {}
  for (;;) {
    if (commas) p.acceptOp(',')
    if (p.acceptWord('ENGINE') || p.acceptWord('TYPE')) {
      p.optionalEquals()
      options.engine = p.nameOrString()
    } else if (
      p.acceptWord('DEFAULT', 'CHARACTER', 'SET') ||
      p.acceptWord('CHARACTER', 'SET') ||
      p.acceptWord('DEFAULT', 'CHARSET') ||
      p.acceptWord('CHARSET')
    ) {
      p.optionalEquals()
      options.charset = p.nameOrString()
    } else if (p.acceptWord('DEFAULT', 'COLLATE') || p.acceptWord('COLLATE')) {
      p.optionalEquals()
      options.collation = p.nameOrString()
    } else if (p.acceptWord('AUTO_INCREMENT')) {
      p.optionalEquals()
      options.autoIncrement = p.integer()
    } else if (p.acceptWord('COMMENT')) {
      p.optionalEquals()
      options.comment = p.string()
    } else if (
      p.acceptOneOf(
        'ROW_FORMAT',
        'KEY_BLOCK_SIZE',
        'AVG_ROW_LENGTH',
        'CHECKSUM',
        'TABLE_CHECKSUM',
        'DELAY_KEY_WRITE',
        'PACK_KEYS',
        'STATS_AUTO_RECALC',
        'STATS_PERSISTENT',
        'STATS_SAMPLE_PAGES',
        'MAX_ROWS',
        'MIN_ROWS',
        'PAGE_CHECKSUM',
        'PAGE_COMPRESSED',
        'PAGE_COMPRESSION_LEVEL',
        'TRANSACTIONAL',
        'INSERT_METHOD',
        'ENCRYPTED',
        'ENCRYPTION_KEY_ID',
        'IETF_QUOTES',
        'SEQUENCE',
        'COMPRESSION',
        'TABLESPACE',
        'STORAGE',
        'CONNECTION',
        'PASSWORD',
      ) !== undefined
    ) {
      p.optionalEquals()
      p.next()
    } else if (p.acceptWord('DATA', 'DIRECTORY') || p.acceptWord('INDEX', 'DIRECTORY')) {
      p.optionalEquals()
      p.string()
    } else if (p.acceptWord('UNION')) {
      p.optionalEquals()
      p.expectOp('(')
      while (!p.acceptOp(')')) p.next()
    } else if (p.acceptWord('WITH', 'SYSTEM', 'VERSIONING')) {
      throw unsupported('system-versioned tables')
    } else if (p.isWord('PARTITION')) {
      throw unsupported('partitioning')
    } else return options
  }
}

/** Reads CREATE ..., from CREATE. */
export function parseCreate(p: Parser): Statement {
  const start = p.next().start
  const orReplace = p.acceptWord('OR', 'REPLACE')
  const temporary = p.acceptWord('TEMPORARY')
  if (p.acceptWord('TABLE')) return createTable(p, start, orReplace, temporary)
  if (temporary) p.fail()
  const indexKind = p.acceptOneOf('UNIQUE', 'FULLTEXT', 'SPATIAL')
  if (p.acceptWord('INDEX')) {
    const ifNotExists = p.acceptWord('IF', 'NOT', 'EXISTS')
    const name = p.name()
    indexOptions(p)
    p.expectWord('ON')
    const table = p.tableName()
    const parts = keyParts(p)
    indexOptions(p)
    while (p.acceptOneOf('ALGORITHM', 'LOCK') !== undefined) {
      p.optionalEquals()
      p.next()
    }
    return {
      kind: 'createIndex',
      orReplace,
      ifNotExists,
      unique: indexKind === 'UNIQUE',
      name,
      table,
      parts,
      start,
      end: p.last,
    }
  }
  if (indexKind !== undefined) p.fail()
  // CREATE ALGORITHM=... DEFINER=... SQL SECURITY ... VIEW
  for (;;) {
    if (p.acceptWord('ALGORITHM')) {
      p.expectOp('=')
      p.next()
    } else if (p.acceptWord('DEFINER')) {
      p.expectOp('=')
      skipUser(p)
    } else if (p.acceptWord('SQL', 'SECURITY')) {
      p.acceptOneOf('DEFINER', 'INVOKER')
    } else break
  }
  if (p.acceptWord('VIEW')) {
    const ifNotExists = p.acceptWord('IF', 'NOT', 'EXISTS')
    const view = p.tableName()
    const columns = p.isOp('(') ? p.nameList() : undefined
    p.expectWord('AS')
    const select = p.select()
    if (p.acceptWord('WITH')) {
      p.acceptOneOf('CASCADED', 'LOCAL')
      p.expectWord('CHECK', 'OPTION')
    }
    return {
      kind: 'createView',
      orReplace,
      ifNotExists,
      view,
      ...(columns === undefined ? {} : { columns }),
      select,
      start,
      end: p.last,
    }
  }
  if (p.acceptOneOf('DATABASE', 'SCHEMA') !== undefined) {
    const ifNotExists = p.acceptWord('IF', 'NOT', 'EXISTS')
    const name = p.name()
    databaseOptions(p)
    return { kind: 'createDatabase', ifNotExists, name, start, end: p.last }
  }
  const what = p.peek()
  if (what.kind === 'word') {
    const word = what.text.toUpperCase()
    if (['TRIGGER', 'PROCEDURE', 'FUNCTION', 'EVENT'].includes(word))
      throw unsupported(`${word.toLowerCase()}s`)
    if (['USER', 'ROLE', 'SEQUENCE', 'SERVER', 'TABLESPACE', 'AGGREGATE', 'PACKAGE'].includes(word))
      throw unsupported(`CREATE ${word}`)
  }
  p.fail()
}

/** Reads a user, such as `root`@`localhost`, as DEFINER names one. */
function skipUser(p: Parser): void {
  if (p.acceptWord('CURRENT_USER')) {
    if (p.acceptOp('(')) p.expectOp(')')
    return
  }
  p.nameOrString()
  if (p.peek().kind === 'variable') p.next()
}

/** Reads the options of a database, such as CHARACTER SET, which change nothing here. */
function databaseOptions(p: Parser): void {
  for (;;) {
    p.acceptWord('DEFAULT')
    if (p.acceptWord('CHARACTER', 'SET') || p.acceptWord('CHARSET') || p.acceptWord('COLLATE')) {
      p.optionalEquals()
      p.nameOrString()
    } else if (p.acceptWord('COMMENT')) {
      p.optionalEquals()
      p.string()
    } else return
  }
}

function createTable(
  p: Parser,
  start: number,
  orReplace: boolean,
  temporary: boolean,
): CreateTable {
  const ifNotExists = p.acceptWord('IF', 'NOT', 'EXISTS')
  const table = p.tableName()
  const columns: ColumnDefinition[] = []
  const constraints: TableConstraint[] = []
  let like: TableName | undefined
  if (p.acceptWord('LIKE')) like = p.tableName()
  else if (p.isOp('(') && p.isWord('LIKE', 1)) {
    p.next()
    p.next()
    like = p.tableName()
    p.expectOp(')')
  } else if (p.isOp('(') && !p.isWord('SELECT', 1) && !p.isWord('WITH', 1)) {
    p.next()
    do {
      const constraint = tableConstraint(p)
      if (constraint !== undefined) constraints.push(constraint.constraint)
      else if (p.isWord('PERIOD') && p.isWord('FOR', 1)) throw unsupported('PERIOD FOR')
      else columns.push(columnDefinition(p))
    } while (p.acceptOp(','))
    p.expectOp(')')
  }
  const options = like === undefined ? tableOptions(p, true) : {}
  let select: Select | undefined
  if (like === undefined) {
    p.acceptOneOf('IGNORE', 'REPLACE')
    p.acceptWord('AS')
    if (p.isWord('SELECT') || p.isWord('WITH') || p.isOp('(')) select = p.select()
  }
  if (like === undefined && select === undefined && columns.length === 0) {
    throw new SqlError(1113, '42000', 'A table must have at least 1 column')
  }
  return {
    kind: 'createTable',
    temporary,
    orReplace,
    ifNotExists,
    table,
    columns,
    constraints,
    options,
    ...(like === undefined ? {} : { like }),
    ...(select === undefined ? {} : { select }),
    start,
    end: p.last,
  }
}

/** Reads FIRST or AFTER column, where ALTER TABLE puts a column. */
function position(p: Parser): ColumnPosition | undefined {
  if (p.acceptWord('FIRST')) return { first: true }
  if (p.acceptWord('AFTER')) return { after: p.name() }
  return undefined
}

/** Reads ALTER ..., from ALTER. */
export function parseAlter(p: Parser): Statement {
  const start = p.next().start
  p.acceptWord('ONLINE')
  p.acceptWord('IGNORE')
  if (p.acceptOneOf('DATABASE', 'SCHEMA') !== undefined) {
    if (
      !p.isWord('DEFAULT') &&
      !p.isWord('CHARACTER') &&
      !p.isWord('CHARSET') &&
      !p.isWord('COLLATE') &&
      !p.isWord('COMMENT')
    )
      p.name()
    databaseOptions(p)
    return { kind: 'noop', start, end: p.last }
  }
  if (!p.acceptWord('TABLE')) {
    const what = p.peek()
    throw unsupported(`ALTER ${what.kind === 'word' ? what.text.toUpperCase() : ''}`.trim())
  }
  const ifExists = p.acceptWord('IF', 'EXISTS')
  const table = p.tableName()
  if (p.acceptWord('WAIT')) p.integer()
  else p.acceptWord('NOWAIT')
  const actions: AlterAction[] = []
  if (p.peek().kind !== 'end' && !p.isOp(';')) {
    do actions.push(...alterActions(p))
    while (p.acceptOp(','))
  }
  const result: AlterTable = { kind: 'alterTable', ifExists, table, actions, start, end: p.last }
  return result
}

/** Reads an action of ALTER TABLE, or the columns that ADD (...) adds. */
function alterActions(p: Parser): AlterAction[] {
  if (p.acceptWord('ADD')) {
    const constraint = tableConstraint(p)
    if (constraint !== undefined) return [{ kind: 'addConstraint', ...constraint }]
    p.acceptWord('COLUMN')
    const ifNotExists = p.acceptWord('IF', 'NOT', 'EXISTS')
    if (p.acceptOp('(')) {
      const added: AlterAction[] = []
      do {
        const inner = tableConstraint(p)
        added.push(
          inner !== undefined
            ? { kind: 'addConstraint', ...inner }
            : { kind: 'addColumn', ifNotExists, column: columnDefinition(p) },
        )
      } while (p.acceptOp(','))
      p.expectOp(')')
      return added
    }
    const column = columnDefinition(p)
    const at = position(p)
    return [
      { kind: 'addColumn', ifNotExists, column, ...(at === undefined ? {} : { position: at }) },
    ]
  }
  return [alterAction(p)]
}

function alterAction(p: Parser): AlterAction {
  if (p.acceptWord('CHANGE')) {
    p.acceptWord('COLUMN')
    const ifExists = p.acceptWord('IF', 'EXISTS')
    const name = p.name()
    const column = columnDefinition(p)
    const at = position(p)
    return {
      kind: 'changeColumn',
      ifExists,
      name,
      column,
      ...(at === undefined ? {} : { position: at }),
    }
  }
  if (p.acceptWord('MODIFY')) {
    p.acceptWord('COLUMN')
    const ifExists = p.acceptWord('IF', 'EXISTS')
    const column = columnDefinition(p)
    const at = position(p)
    return {
      kind: 'changeColumn',
      ifExists,
      name: column.name,
      column,
      ...(at === undefined ? {} : { position: at }),
    }
  }
  if (p.acceptWord('ALTER')) {
    p.acceptWord('COLUMN')
    const name = p.name()
    if (p.acceptWord('SET', 'DEFAULT')) {
      return { kind: 'alterDefault', name, default: defaultExpression(p) }
    }
    p.expectWord('DROP', 'DEFAULT')
    return { kind: 'alterDefault', name }
  }
  if (p.acceptWord('DROP')) {
    if (p.acceptWord('PRIMARY', 'KEY')) return { kind: 'dropPrimaryKey' }
    if (p.acceptOneOf('INDEX', 'KEY') !== undefined) {
      const ifExists = p.acceptWord('IF', 'EXISTS')
      return { kind: 'dropIndex', ifExists, name: p.name() }
    }
    if (p.acceptWord('FOREIGN', 'KEY')) {
      const ifExists = p.acceptWord('IF', 'EXISTS')
      return { kind: 'dropForeignKey', ifExists, name: p.name() }
    }
    if (p.acceptOneOf('CONSTRAINT', 'CHECK') !== undefined) {
      const ifExists = p.acceptWord('IF', 'EXISTS')
      return { kind: 'dropConstraint', ifExists, name: p.name() }
    }
    p.acceptWord('COLUMN')
    const ifExists = p.acceptWord('IF', 'EXISTS')
    const name = p.name()
    p.acceptOneOf('RESTRICT', 'CASCADE')
    return { kind: 'dropColumn', ifExists, name }
  }
  if (p.acceptWord('RENAME')) {
    if (p.acceptOneOf('INDEX', 'KEY') !== undefined) {
      const from = p.name()
      p.expectWord('TO')
      return { kind: 'renameIndex', from, to: p.name() }
    }
    if (p.acceptWord('COLUMN')) {
      const from = p.name()
      p.expectWord('TO')
      return { kind: 'renameColumn', from, to: p.name() }
    }
    p.acceptOneOf('TO', 'AS')
    return { kind: 'renameTable', to: p.tableName() }
  }
  if (p.acceptWord('CONVERT', 'TO')) {
    if (!p.acceptWord('CHARACTER', 'SET')) p.expectWord('CHARSET')
    const charset = p.nameOrString()
    const collation = p.acceptWord('COLLATE') ? p.nameOrString() : undefined
    return {
      kind: 'options',
      options: { charset, ...(collation === undefined ? {} : { collation }) },
    }
  }
  if (p.acceptOneOf('DISABLE', 'ENABLE') !== undefined) {
    p.expectWord('KEYS')
    return { kind: 'none' }
  }
  if (p.acceptWord('FORCE')) return { kind: 'none' }
  if (p.acceptOneOf('ALGORITHM', 'LOCK') !== undefined) {
    p.optionalEquals()
    p.next()
    return { kind: 'none' }
  }
  if (p.acceptWord('ORDER', 'BY')) {
    p.orderList()
    return { kind: 'none' }
  }
  const options = tableOptions(p, false)
  if (Object.keys(options).length === 0 && !p.isOp(',') && p.peek().kind !== 'end' && !p.isOp(';'))
    p.fail()
  return { kind: 'options', options }
}

/** Reads DROP ..., from DROP. */
export function parseDrop(p: Parser): Statement {
  const start = p.next().start
  const temporary = p.acceptWord('TEMPORARY')
  if (p.acceptWord('TABLE') || (!temporary && p.acceptWord('TABLES'))) {
    const ifExists = p.acceptWord('IF', 'EXISTS')
    const tables = [p.tableName()]
    while (p.acceptOp(',')) tables.push(p.tableName())
    p.acceptOneOf('RESTRICT', 'CASCADE')
    return { kind: 'dropTable', temporary, ifExists, tables, start, end: p.last }
  }
  if (temporary) p.fail()
  if (p.acceptWord('INDEX')) {
    const ifExists = p.acceptWord('IF', 'EXISTS')
    const name = p.acceptWord('PRIMARY') ? 'PRIMARY' : p.name()
    p.expectWord('ON')
    const table = p.tableName()
    return { kind: 'dropIndex', ifExists, name, table, start, end: p.last }
  }
  if (p.acceptWord('VIEW')) {
    const ifExists = p.acceptWord('IF', 'EXISTS')
    const views = [p.tableName()]
    while (p.acceptOp(',')) views.push(p.tableName())
    p.acceptOneOf('RESTRICT', 'CASCADE')
    return { kind: 'dropView', ifExists, views, start, end: p.last }
  }
  if (p.acceptOneOf('DATABASE', 'SCHEMA') !== undefined) {
    const ifExists = p.acceptWord('IF', 'EXISTS')
    return { kind: 'dropDatabase', ifExists, name: p.name(), start, end: p.last }
  }
  const what = p.acceptOneOf('TRIGGER', 'PROCEDURE', 'FUNCTION', 'EVENT')
  if (what !== undefined) {
    // FiveRunner's database has none of these, so dropping one that may not exist does nothing.
    const ifExists = p.acceptWord('IF', 'EXISTS')
    const name = p.tableName()
    if (ifExists) return { kind: 'noop', start, end: p.last }
    if (what === 'TRIGGER') throw new SqlError(1360, 'HY000', 'Trigger does not exist')
    if (what === 'EVENT') throw new SqlError(1539, 'HY000', `Unknown event '${name.name}'`)
    throw new SqlError(
      1305,
      '42000',
      `${what} ${name.schema ?? ''}${name.schema === undefined ? '' : '.'}${name.name} does not exist`,
    )
  }
  const other = p.peek()
  throw unsupported(`DROP ${other.kind === 'word' ? other.text.toUpperCase() : ''}`.trim())
}

/** Reads TRUNCATE [TABLE] name. */
export function parseTruncate(p: Parser): Statement {
  const start = p.next().start
  p.acceptWord('TABLE')
  return { kind: 'truncate', table: p.tableName(), start, end: p.last }
}

/** Reads RENAME TABLE a TO b, ... */
export function parseRename(p: Parser): Statement {
  const start = p.next().start
  if (!p.acceptWord('TABLE') && !p.acceptWord('TABLES')) {
    const what = p.peek()
    throw unsupported(`RENAME ${what.kind === 'word' ? what.text.toUpperCase() : ''}`.trim())
  }
  const renames: { from: TableName; to: TableName }[] = []
  do {
    const from = p.tableName()
    p.expectWord('TO')
    renames.push({ from, to: p.tableName() })
  } while (p.acceptOp(','))
  return { kind: 'renameTable', renames, start, end: p.last }
}

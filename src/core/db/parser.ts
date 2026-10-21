import type {
  Assignment,
  BinaryOperator,
  CastType,
  ColumnName,
  CommonTable,
  Delete,
  Expression,
  ExpressionNode,
  Insert,
  InsertSource,
  IntervalUnit,
  Limit,
  OrderItem,
  QueryBody,
  Select,
  SelectCore,
  SelectItem,
  SetItem,
  ShowStatement,
  Statement,
  TableName,
  TableRef,
  Update,
} from './ast.ts'
import { parseAlter, parseCreate, parseDrop, parseRename, parseTruncate } from './ddl.ts'
import { lex, SqlError, syntaxError, type Token } from './lexer.ts'

/**
 * The words that MariaDB reserves, which name nothing unless they are in
 * backticks, but after a dot, as in t.order.
 */
const RESERVED: ReadonlySet<string> = new Set(
  `ACCESSIBLE ADD ALL ALTER ANALYZE AND AS ASC ASENSITIVE BEFORE BETWEEN BIGINT BINARY BLOB BOTH BY
  CALL CASCADE CASE CHANGE CHAR CHARACTER CHECK COLLATE COLUMN CONDITION CONSTRAINT CONTINUE CONVERT
  CREATE CROSS CURRENT_DATE CURRENT_ROLE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE
  DATABASES DAY_HOUR DAY_MICROSECOND DAY_MINUTE DAY_SECOND DEC DECIMAL DECLARE DEFAULT DELAYED DELETE
  DESC DESCRIBE DETERMINISTIC DISTINCT DISTINCTROW DIV DOUBLE DROP DUAL EACH ELSE ELSEIF ENCLOSED
  ESCAPED EXCEPT EXISTS EXIT EXPLAIN FALSE FETCH FLOAT FLOAT4 FLOAT8 FOR FORCE FOREIGN FROM FULLTEXT
  GENERAL GRANT GROUP HAVING HIGH_PRIORITY HOUR_MICROSECOND HOUR_MINUTE HOUR_SECOND IF IGNORE IN INDEX
  INFILE INNER INOUT INSENSITIVE INSERT INT INT1 INT2 INT3 INT4 INT8 INTEGER INTERSECT INTERVAL INTO
  IS ITERATE JOIN KEY KEYS KILL LEADING LEAVE LEFT LIKE LIMIT LINEAR LINES LOAD LOCALTIME
  LOCALTIMESTAMP LOCK LONG LONGBLOB LONGTEXT LOOP LOW_PRIORITY MATCH MAXVALUE MEDIUMBLOB MEDIUMINT
  MEDIUMTEXT MIDDLEINT MINUTE_MICROSECOND MINUTE_SECOND MOD MODIFIES NATURAL NOT NO_WRITE_TO_BINLOG
  NULL NUMERIC OFFSET ON OPTIMIZE OPTION OPTIONALLY OR ORDER OUT OUTER OUTFILE OVER PARTITION PRECISION
  PRIMARY PROCEDURE PURGE RANGE READ READS READ_WRITE REAL RECURSIVE REFERENCES REGEXP RELEASE RENAME
  REPEAT REPLACE REQUIRE RESIGNAL RESTRICT RETURN RETURNING REVOKE RIGHT RLIKE ROWS ROW_NUMBER SCHEMA
  SCHEMAS SECOND_MICROSECOND SELECT SENSITIVE SEPARATOR SET SHOW SIGNAL SMALLINT SPATIAL SPECIFIC SQL
  SQLEXCEPTION SQLSTATE SQLWARNING SQL_BIG_RESULT SQL_CALC_FOUND_ROWS SQL_SMALL_RESULT SSL STARTING
  STRAIGHT_JOIN TABLE TERMINATED THEN TINYBLOB TINYINT TINYTEXT TO TRAILING TRIGGER TRUE UNDO UNION
  UNIQUE UNLOCK UNSIGNED UPDATE USAGE USE USING UTC_DATE UTC_TIME UTC_TIMESTAMP VALUES VARBINARY
  VARCHAR VARCHARACTER VARYING WHEN WHERE WHILE WINDOW WITH WRITE XOR YEAR_MONTH ZEROFILL`.split(
    /\s+/,
  ),
)

/** The reserved words that name functions before parentheses, as LEFT(name, 1) does. */
const RESERVED_FUNCTIONS: ReadonlySet<string> = new Set([
  'CHAR',
  'CONVERT',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'CURRENT_TIMESTAMP',
  'CURRENT_USER',
  'DATABASE',
  'IF',
  'INSERT',
  'INTERVAL',
  'LEFT',
  'LOCALTIME',
  'LOCALTIMESTAMP',
  'MOD',
  'REPEAT',
  'REPLACE',
  'RIGHT',
  'ROW_NUMBER',
  'SCHEMA',
  'UTC_DATE',
  'UTC_TIME',
  'UTC_TIMESTAMP',
])

/** The functions of the current time and of the user that need no parentheses, and the names they call. */
const NILADIC: Readonly<Record<string, string>> = {
  CURRENT_TIMESTAMP: 'NOW',
  LOCALTIME: 'NOW',
  LOCALTIMESTAMP: 'NOW',
  CURRENT_DATE: 'CURDATE',
  CURRENT_TIME: 'CURTIME',
  UTC_TIMESTAMP: 'UTC_TIMESTAMP',
  UTC_DATE: 'UTC_DATE',
  UTC_TIME: 'UTC_TIME',
  CURRENT_USER: 'CURRENT_USER',
}

const INTERVAL_UNITS: ReadonlySet<string> = new Set<IntervalUnit>([
  'MICROSECOND',
  'SECOND',
  'MINUTE',
  'HOUR',
  'DAY',
  'WEEK',
  'MONTH',
  'QUARTER',
  'YEAR',
  'SECOND_MICROSECOND',
  'MINUTE_MICROSECOND',
  'MINUTE_SECOND',
  'HOUR_MICROSECOND',
  'HOUR_SECOND',
  'HOUR_MINUTE',
  'DAY_MICROSECOND',
  'DAY_SECOND',
  'DAY_MINUTE',
  'DAY_HOUR',
  'YEAR_MONTH',
])

/** The units that TIMESTAMPADD, TIMESTAMPDIFF and EXTRACT also take with SQL_TSI_ before them. */
function intervalUnit(word: string): IntervalUnit | undefined {
  const upper = word.toUpperCase().replace(/^SQL_TSI_/, '')
  return INTERVAL_UNITS.has(upper) ? (upper as IntervalUnit) : undefined
}

const COMPARISON_OPERATORS: Readonly<Record<string, BinaryOperator>> = {
  '=': '=',
  '<=>': '<=>',
  '<>': '!=',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
}

/** MariaDB's error for an empty query. */
function emptyQuery(): SqlError {
  return new SqlError(1065, '42000', 'Query was empty')
}

/**
 * Reads one statement, as MariaDB does for connections that do not run
 * many at once: a semicolon may end it, but nothing may follow.
 */
export function parseStatement(sql: string): Statement {
  const parser = new Parser(sql)
  if (parser.peek().kind === 'end' || (parser.isOp(';') && parser.peek(1).kind === 'end')) {
    throw emptyQuery()
  }
  const statement = parser.statement()
  parser.acceptOp(';')
  parser.expectEnd()
  return statement
}

/** A statement of a script, with its text and where it starts, or the error it gives. */
export type ScriptStatement =
  | { readonly statement: Statement; readonly text: string; readonly start: number }
  | { readonly error: SqlError; readonly text: string; readonly start: number }

/**
 * The statements of SQL that semicolons separate, such as those of an .sql
 * file, with the text of each, from its first token to its last. The
 * statements' offsets are in the whole SQL, which runs them, as their
 * texts may start or end in comments that MariaDB runs. A statement that
 * MariaDB cannot read goes on to the next semicolon, and gives the error
 * it gives alone, as the mysql client sends each statement of a file on
 * its own.
 */
export function parseScript(sql: string): ScriptStatement[] {
  const statements: ScriptStatement[] = []
  const parser = new Parser(sql)
  for (;;) {
    while (parser.acceptOp(';'));
    if (parser.peek().kind === 'end') return statements
    const start = parser.peek().start
    try {
      const statement = parser.statement()
      if (parser.peek().kind !== 'end' && !parser.isOp(';')) parser.fail()
      statements.push({ statement, text: sql.slice(start, parser.last), start })
    } catch (error) {
      if (!(error instanceof SqlError)) throw error
      while (parser.peek().kind !== 'end' && !parser.isOp(';')) parser.next()
      const text = sql.slice(start, parser.position).trimEnd()
      let alone = error
      try {
        parseStatement(text)
      } catch (failure) {
        if (failure instanceof SqlError) alone = failure
      }
      statements.push({ error: alone, text, start })
    }
  }
}

/** Reads MySQL's SQL from its tokens. */
export class Parser {
  readonly sql: string
  readonly #tokens: Token[]
  #at = 0
  /** The parameters, ?, read so far. */
  #params = 0

  constructor(sql: string) {
    this.sql = sql
    this.#tokens = lex(sql)
  }

  /** The token `offset` tokens on, which is the end once there are none. */
  peek(offset = 0): Token {
    return this.#tokens[Math.min(this.#at + offset, this.#tokens.length - 1)]!
  }

  next(): Token {
    const token = this.peek()
    if (token.kind !== 'end') this.#at++
    return token
  }

  /** Where the next token starts. */
  get position(): number {
    return this.peek().start
  }

  /** Where the last token read ends. */
  get last(): number {
    return this.#at === 0 ? 0 : this.#tokens[this.#at - 1]!.end
  }

  /** Fails with MariaDB's syntax error at `token`, the next one by default. */
  fail(token: Token = this.peek()): never {
    throw syntaxError(this.sql, token.start)
  }

  /** Whether the token `offset` tokens on is the word `word`, in any case, and not in backticks. */
  isWord(word: string, offset = 0): boolean {
    const token = this.peek(offset)
    return token.kind === 'word' && token.text.toUpperCase() === word
  }

  /** Reads the words, in order, if they come next. */
  acceptWord(...words: string[]): boolean {
    if (!words.every((word, i) => this.isWord(word, i))) return false
    this.#at += words.length
    return true
  }

  expectWord(...words: string[]): void {
    for (const word of words) if (!this.acceptWord(word)) this.fail()
  }

  /** The word that comes next, in upper case, if it is one of `words`, which it reads. */
  acceptOneOf<const W extends string>(...words: W[]): W | undefined {
    const found = words.find((word) => this.isWord(word))
    if (found !== undefined) this.#at++
    return found
  }

  isOp(op: string, offset = 0): boolean {
    const token = this.peek(offset)
    return token.kind === 'op' && token.text === op
  }

  acceptOp(op: string): boolean {
    if (!this.isOp(op)) return false
    this.#at++
    return true
  }

  expectOp(op: string): void {
    if (!this.acceptOp(op)) this.fail()
  }

  expectEnd(): void {
    if (this.peek().kind !== 'end') this.fail()
  }

  /** Whether a name comes next: one in backticks, or a word that MariaDB does not reserve. */
  isName(offset = 0): boolean {
    const token = this.peek(offset)
    return (
      token.kind === 'ident' || (token.kind === 'word' && !RESERVED.has(token.text.toUpperCase()))
    )
  }

  /** Reads a name: one in backticks, or a word that MariaDB does not reserve. */
  name(): string {
    const token = this.peek()
    if (!this.isName()) this.fail()
    this.#at++
    return token.kind === 'ident' || token.kind === 'word' ? token.text : ''
  }

  /** Reads a name after a dot, which may be a reserved word. */
  #qualifier(): string {
    const token = this.next()
    if (token.kind === 'ident' || token.kind === 'word') return token.text
    this.fail(token)
  }

  /** Reads a name, or a string, as aliases, engines and character sets may be written. */
  nameOrString(): string {
    const token = this.peek()
    if (token.kind === 'string') {
      this.#at++
      return token.text
    }
    return this.name()
  }

  /** Reads a string, with those that follow it, which MariaDB joins into one. */
  string(): string {
    const token = this.peek()
    if (token.kind !== 'string') this.fail()
    this.#at++
    let text = token.text
    for (let next = this.peek(); next.kind === 'string'; next = this.peek()) {
      text += next.text
      this.#at++
    }
    return text
  }

  /** Reads a whole number that is written as one, as lengths of types are. */
  integer(): number {
    const token = this.peek()
    if (token.kind !== 'number' || !/^\d+$/.test(token.text)) this.fail()
    this.#at++
    return Number(token.text)
  }

  /** Reads a table's name: a name, maybe with its database's before it. */
  tableName(): TableName {
    const first = this.name()
    if (!this.acceptOp('.')) return { name: first }
    return { schema: first, name: this.#qualifier() }
  }

  /** Reads names in parentheses that commas separate. */
  nameList(): string[] {
    this.expectOp('(')
    const names = [this.name()]
    while (this.acceptOp(',')) names.push(this.name())
    this.expectOp(')')
    return names
  }

  /** Reads an equals sign that may be left out, as in ENGINE = InnoDB. */
  optionalEquals(): void {
    this.acceptOp('=')
  }

  // Statements

  statement(): Statement {
    const token = this.peek()
    if (this.isOp('(') || this.isWord('SELECT') || this.isWord('WITH')) return this.select()
    if (token.kind !== 'word') this.fail()
    switch (token.text.toUpperCase()) {
      case 'INSERT':
      case 'REPLACE':
        return this.#insert()
      case 'UPDATE':
        return this.#update()
      case 'DELETE':
        return this.#delete()
      case 'CREATE':
        return parseCreate(this)
      case 'ALTER':
        return parseAlter(this)
      case 'DROP':
        return parseDrop(this)
      case 'TRUNCATE':
        return parseTruncate(this)
      case 'RENAME':
        return parseRename(this)
      case 'USE': {
        this.next()
        return { kind: 'use', name: this.name(), start: token.start, end: this.last }
      }
      case 'SET':
        return this.#set()
      case 'START':
        this.next()
        this.expectWord('TRANSACTION')
        this.#transactionCharacteristics()
        return { kind: 'begin', start: token.start, end: this.last }
      case 'BEGIN':
        this.next()
        this.acceptWord('WORK')
        return { kind: 'begin', start: token.start, end: this.last }
      case 'COMMIT':
        this.next()
        this.acceptWord('WORK')
        this.#completion()
        return { kind: 'commit', start: token.start, end: this.last }
      case 'ROLLBACK': {
        this.next()
        this.acceptWord('WORK')
        if (this.acceptWord('TO')) {
          this.acceptWord('SAVEPOINT')
          return { kind: 'rollbackTo', savepoint: this.name(), start: token.start, end: this.last }
        }
        this.#completion()
        return { kind: 'rollback', start: token.start, end: this.last }
      }
      case 'SAVEPOINT':
        this.next()
        return { kind: 'savepoint', savepoint: this.name(), start: token.start, end: this.last }
      case 'RELEASE':
        this.next()
        this.expectWord('SAVEPOINT')
        return { kind: 'release', savepoint: this.name(), start: token.start, end: this.last }
      case 'SHOW':
        return this.#show()
      case 'DESCRIBE':
      case 'DESC':
      case 'EXPLAIN': {
        this.next()
        if (
          this.isWord('SELECT') ||
          this.isWord('UPDATE') ||
          this.isWord('DELETE') ||
          this.isWord('INSERT')
        ) {
          throw unsupported('EXPLAIN')
        }
        const table = this.tableName()
        let like: Expression | undefined
        if (this.peek().kind === 'string' || this.isName()) {
          const start = this.position
          const text = this.nameOrString()
          like = { kind: 'string', text, binary: false, start, end: this.last }
        }
        return {
          kind: 'showColumns',
          full: false,
          table,
          ...(like === undefined ? {} : { like }),
          start: token.start,
          end: this.last,
        }
      }
      case 'LOCK':
        this.next()
        this.acceptOneOf('TABLE', 'TABLES')
        this.#skipToEnd()
        return { kind: 'noop', start: token.start, end: this.last }
      case 'UNLOCK':
        this.next()
        if (this.acceptOneOf('TABLE', 'TABLES') === undefined) this.fail()
        return { kind: 'noop', start: token.start, end: this.last }
      case 'OPTIMIZE':
      case 'ANALYZE':
      case 'CHECK':
      case 'REPAIR': {
        const op = token.text.toLowerCase()
        this.next()
        this.acceptOneOf('NO_WRITE_TO_BINLOG', 'LOCAL')
        if (this.acceptOneOf('TABLE', 'TABLES') === undefined) this.fail()
        const tables = [this.tableName()]
        while (this.acceptOp(',')) tables.push(this.tableName())
        this.#skipToEnd()
        return { kind: 'noop', maintenance: { op, tables }, start: token.start, end: this.last }
      }
      case 'DO': {
        this.next()
        const expressions = [this.expression()]
        while (this.acceptOp(',')) expressions.push(this.expression())
        return { kind: 'do', expressions, start: token.start, end: this.last }
      }
      case 'CALL':
        throw unsupported('stored procedures')
      case 'HANDLER':
      case 'LOAD':
      case 'GRANT':
      case 'REVOKE':
      case 'FLUSH':
      case 'KILL':
        throw unsupported(token.text.toUpperCase())
      default:
        this.fail()
    }
  }

  /** Skips what follows, up to the end of the statement, for statements whose options change nothing. */
  #skipToEnd(): void {
    while (this.peek().kind !== 'end' && !this.isOp(';')) this.next()
  }

  /** Reads AND [NO] CHAIN and [NO] RELEASE after COMMIT and ROLLBACK, which change nothing here. */
  #completion(): void {
    if (this.acceptWord('AND')) {
      this.acceptWord('NO')
      this.expectWord('CHAIN')
    }
    this.acceptWord('NO')
    this.acceptWord('RELEASE')
  }

  /** Reads what START TRANSACTION may say of the transaction: READ ONLY, READ WRITE, or WITH CONSISTENT SNAPSHOT. */
  #transactionCharacteristics(): void {
    do {
      if (this.acceptWord('WITH')) this.expectWord('CONSISTENT', 'SNAPSHOT')
      else if (this.acceptWord('READ')) {
        if (this.acceptOneOf('ONLY', 'WRITE') === undefined) this.fail()
      }
    } while (this.acceptOp(','))
  }

  #set(): Statement {
    const start = this.next().start
    const items: SetItem[] = []
    if (
      this.isWord('TRANSACTION') ||
      ((this.isWord('SESSION') || this.isWord('GLOBAL')) && this.isWord('TRANSACTION', 1))
    ) {
      this.acceptOneOf('SESSION', 'GLOBAL')
      this.next()
      do {
        if (this.acceptWord('ISOLATION', 'LEVEL')) {
          if (this.acceptWord('READ')) {
            if (this.acceptOneOf('COMMITTED', 'UNCOMMITTED') === undefined) this.fail()
          } else if (this.acceptWord('REPEATABLE')) this.expectWord('READ')
          else this.expectWord('SERIALIZABLE')
        } else {
          this.expectWord('READ')
          if (this.acceptOneOf('ONLY', 'WRITE') === undefined) this.fail()
        }
      } while (this.acceptOp(','))
      return { kind: 'set', items: [{ kind: 'transaction' }], start, end: this.last }
    }
    do items.push(this.#setItem())
    while (this.acceptOp(','))
    return { kind: 'set', items, start, end: this.last }
  }

  #setItem(): SetItem {
    if (this.acceptWord('NAMES')) {
      const charset = this.isWord('DEFAULT') ? (this.next(), 'utf8mb4') : this.nameOrString()
      const collation = this.acceptWord('COLLATE') ? this.nameOrString() : undefined
      return { kind: 'names', charset, ...(collation === undefined ? {} : { collation }) }
    }
    if (this.acceptWord('CHARACTER', 'SET') || this.acceptWord('CHARSET')) {
      const charset = this.isWord('DEFAULT') ? (this.next(), 'utf8mb4') : this.nameOrString()
      return { kind: 'names', charset }
    }
    const token = this.peek()
    let name: string
    let system: boolean
    let scope: 'GLOBAL' | 'SESSION' | undefined
    if (token.kind === 'variable') {
      this.next()
      ;({ name, scope } = variableScope(token.text, token.system))
      system = token.system
    } else {
      const given = this.acceptOneOf('GLOBAL', 'SESSION', 'LOCAL')
      scope = given === undefined ? undefined : given === 'GLOBAL' ? 'GLOBAL' : 'SESSION'
      name = this.name()
      if (this.acceptOp('.')) name = `${name}.${this.#qualifier()}`
      system = true
    }
    if (!this.acceptOp('=')) this.expectOp(':=')
    const value =
      system && this.acceptOneOf('DEFAULT') !== undefined ? undefined : this.#setValue(system)
    return {
      kind: 'variable',
      name,
      system,
      ...(scope === undefined ? {} : { scope }),
      ...(value === undefined ? {} : { value }),
    }
  }

  /** Reads the value SET gives a variable, in which ON and OFF are strings for those of the system. */
  #setValue(system: boolean): Expression {
    const token = this.peek()
    if (
      system &&
      token.kind === 'word' &&
      ['ON', 'OFF'].includes(token.text.toUpperCase()) &&
      (this.isOp(',', 1) || this.isOp(';', 1) || this.peek(1).kind === 'end')
    ) {
      this.next()
      return { kind: 'string', text: token.text, binary: false, start: token.start, end: token.end }
    }
    return this.expression()
  }

  #show(): ShowStatement {
    const start = this.next().start
    const full = this.acceptWord('FULL')
    const scope = this.acceptOneOf('GLOBAL', 'SESSION', 'LOCAL')
    const filter = () => {
      if (this.acceptWord('LIKE')) return { like: this.expression() }
      if (this.acceptWord('WHERE')) return { where: this.expression() }
      return {}
    }
    const fromDatabase = () => {
      if (this.acceptOneOf('FROM', 'IN') !== undefined) this.name()
    }
    if (scope === undefined && this.acceptWord('TABLES')) {
      fromDatabase()
      return { kind: 'showTables', full, ...filter(), start, end: this.last }
    }
    if (scope === undefined && this.acceptOneOf('COLUMNS', 'FIELDS') !== undefined) {
      if (this.acceptOneOf('FROM', 'IN') === undefined) this.fail()
      let table = this.tableName()
      if (this.acceptOneOf('FROM', 'IN') !== undefined)
        table = { schema: this.name(), name: table.name }
      return { kind: 'showColumns', full, table, ...filter(), start, end: this.last }
    }
    if (
      !full &&
      scope === undefined &&
      this.acceptOneOf('INDEX', 'INDEXES', 'KEYS') !== undefined
    ) {
      if (this.acceptOneOf('FROM', 'IN') === undefined) this.fail()
      let table = this.tableName()
      if (this.acceptOneOf('FROM', 'IN') !== undefined)
        table = { schema: this.name(), name: table.name }
      if (this.acceptWord('WHERE')) this.expression()
      return { kind: 'showIndex', table, start, end: this.last }
    }
    if (!full && scope === undefined && this.acceptWord('CREATE', 'TABLE')) {
      return { kind: 'showCreateTable', table: this.tableName(), start, end: this.last }
    }
    if (!full && scope === undefined && this.acceptOneOf('DATABASES', 'SCHEMAS') !== undefined) {
      const like = this.acceptWord('LIKE') ? this.expression() : undefined
      return {
        kind: 'showDatabases',
        ...(like === undefined ? {} : { like }),
        start,
        end: this.last,
      }
    }
    if (!full && this.acceptWord('VARIABLES')) {
      return { kind: 'showVariables', ...filter(), start, end: this.last }
    }
    if (!full && scope === undefined && this.acceptOneOf('WARNINGS', 'ERRORS') !== undefined) {
      if (this.acceptWord('LIMIT')) {
        this.integer()
        if (this.acceptOp(',')) this.integer()
      }
      return { kind: 'showWarnings', start, end: this.last }
    }
    throw unsupported(
      `SHOW ${this.sql.slice(this.position).split(/\s+/)[0]?.toUpperCase() ?? ''}`.trim(),
    )
  }

  // Queries

  /** Reads a query: SELECTs that set operations may join, with what WITH names, an order and a limit. */
  select(): Select {
    const start = this.position
    let withClause: Select['with']
    if (this.acceptWord('WITH')) {
      const recursive = this.acceptWord('RECURSIVE')
      const tables: CommonTable[] = []
      do {
        const name = this.name()
        const columns = this.isOp('(') ? this.nameList() : undefined
        this.expectWord('AS')
        this.expectOp('(')
        const select = this.select()
        this.expectOp(')')
        tables.push({ name, ...(columns === undefined ? {} : { columns }), select })
      } while (this.acceptOp(','))
      withClause = { recursive, tables }
    }
    const body = this.#queryBody()
    const orderBy = this.acceptWord('ORDER', 'BY') ? this.orderList() : undefined
    const limit = this.#limit()
    const locking = this.#locking()
    return {
      kind: 'select',
      ...(withClause === undefined ? {} : { with: withClause }),
      body,
      ...(orderBy === undefined ? {} : { orderBy }),
      ...(limit === undefined ? {} : { limit }),
      locking,
      start,
      end: this.last,
    }
  }

  /** Reads FOR UPDATE, LOCK IN SHARE MODE or FOR SHARE, with their options. */
  #locking(): boolean {
    if (this.acceptWord('FOR', 'UPDATE') || this.acceptWord('FOR', 'SHARE')) {
      if (this.acceptWord('WAIT')) this.integer()
      else if (!this.acceptWord('NOWAIT')) this.acceptWord('SKIP', 'LOCKED')
      return true
    }
    if (this.acceptWord('LOCK', 'IN', 'SHARE', 'MODE')) return true
    return false
  }

  /** Reads SELECTs that UNION and EXCEPT join, which bind less tightly than INTERSECT. */
  #queryBody(): QueryBody {
    let left = this.#intersection()
    for (;;) {
      const kind = this.acceptOneOf('UNION', 'EXCEPT')
      if (kind === undefined) return left
      const all = this.acceptWord('ALL')
      if (!all) this.acceptWord('DISTINCT')
      const right = this.#intersection()
      left = {
        kind: kind === 'UNION' ? 'union' : 'except',
        all,
        left,
        right,
        start: left.start,
        end: right.end,
      }
    }
  }

  #intersection(): QueryBody {
    let left = this.#queryPrimary()
    while (this.acceptWord('INTERSECT')) {
      const all = this.acceptWord('ALL')
      if (!all) this.acceptWord('DISTINCT')
      const right = this.#queryPrimary()
      left = { kind: 'intersect', all, left, right, start: left.start, end: right.end }
    }
    return left
  }

  #queryPrimary(): QueryBody {
    const start = this.position
    if (this.acceptOp('(')) {
      const select = this.select()
      this.expectOp(')')
      return { kind: 'parens', select, start, end: this.last }
    }
    return this.#selectCore()
  }

  #selectCore(): SelectCore {
    const start = this.position
    this.expectWord('SELECT')
    let distinct = false
    let calcFoundRows = false
    for (;;) {
      const option = this.acceptOneOf(
        'ALL',
        'DISTINCT',
        'DISTINCTROW',
        'HIGH_PRIORITY',
        'STRAIGHT_JOIN',
        'SQL_SMALL_RESULT',
        'SQL_BIG_RESULT',
        'SQL_BUFFER_RESULT',
        'SQL_CACHE',
        'SQL_NO_CACHE',
        'SQL_CALC_FOUND_ROWS',
      )
      if (option === undefined) break
      if (option === 'DISTINCT' || option === 'DISTINCTROW') distinct = true
      if (option === 'SQL_CALC_FOUND_ROWS') calcFoundRows = true
    }
    const items = [this.#selectItem()]
    while (this.acceptOp(',')) items.push(this.#selectItem())
    if (this.isWord('INTO')) throw unsupported('SELECT ... INTO')
    let from: TableRef[] = []
    if (this.acceptWord('FROM')) {
      if (this.acceptWord('DUAL')) from = []
      else from = this.tableRefs()
    }
    const where = this.acceptWord('WHERE') ? this.expression() : undefined
    let groupBy: OrderItem[] | undefined
    let rollup = false
    if (this.acceptWord('GROUP', 'BY')) {
      groupBy = this.orderList()
      rollup = this.acceptWord('WITH', 'ROLLUP')
    }
    const having = this.acceptWord('HAVING') ? this.expression() : undefined
    if (this.isWord('WINDOW')) throw unsupported('WINDOW')
    return {
      kind: 'core',
      distinct,
      calcFoundRows,
      items,
      from,
      ...(where === undefined ? {} : { where }),
      ...(groupBy === undefined ? {} : { groupBy }),
      ...(rollup ? { rollup } : {}),
      ...(having === undefined ? {} : { having }),
      start,
      end: this.last,
    }
  }

  #selectItem(): SelectItem {
    const start = this.position
    if (this.acceptOp('*')) return { kind: 'star', start, end: this.last }
    // t.* and db.t.*
    if (this.isName() && this.isOp('.', 1)) {
      if (this.isOp('*', 2)) {
        const name = this.name()
        this.next()
        this.next()
        return { kind: 'star', table: { name }, start, end: this.last }
      }
      if (
        (this.peek(2).kind === 'word' || this.peek(2).kind === 'ident') &&
        this.isOp('.', 3) &&
        this.isOp('*', 4)
      ) {
        const schema = this.name()
        this.next()
        const name = this.#qualifier()
        this.next()
        this.next()
        return { kind: 'star', table: { schema, name }, start, end: this.last }
      }
    }
    const expr = this.expression()
    const end = this.last
    const alias = this.#alias()
    return { kind: 'expr', expr, ...(alias === undefined ? {} : { alias }), start, end }
  }

  /** Reads an alias, after AS or without it, which may be a string. */
  #alias(): string | undefined {
    if (this.acceptWord('AS')) return this.nameOrString()
    if (this.isName() || this.peek().kind === 'string') return this.nameOrString()
    return undefined
  }

  /** Reads expressions that commas separate, each maybe with ASC or DESC after it. */
  orderList(): OrderItem[] {
    const items: OrderItem[] = []
    do {
      const expr = this.expression()
      const order = this.acceptOneOf('ASC', 'DESC')
      items.push({ expr, descending: order === 'DESC' })
    } while (this.acceptOp(','))
    return items
  }

  /** Reads LIMIT count, LIMIT offset, count or LIMIT count OFFSET offset. */
  #limit(): Limit | undefined {
    if (!this.acceptWord('LIMIT')) return undefined
    const first = this.#limitValue()
    if (this.acceptOp(',')) return { count: this.#limitValue(), offset: first }
    if (this.acceptWord('OFFSET')) return { count: first, offset: this.#limitValue() }
    return { count: first }
  }

  /** Reads what LIMIT takes: a whole number, or a parameter. */
  #limitValue(): Expression {
    const token = this.peek()
    if (token.kind === 'param') return this.#primary()
    if (token.kind === 'number' && /^\d+$/.test(token.text)) {
      this.next()
      return { kind: 'number', text: token.text, start: token.start, end: token.end }
    }
    this.fail()
  }

  /** Reads tables that commas separate, each maybe with joins. */
  tableRefs(): TableRef[] {
    const refs = [this.#tableRef()]
    while (this.acceptOp(',')) refs.push(this.#tableRef())
    return refs
  }

  #tableRef(): TableRef {
    let left = this.#tablePrimary()
    for (;;) {
      const start = left.start
      let join: 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS' | 'STRAIGHT'
      let natural = false
      if (this.acceptWord('NATURAL')) {
        natural = true
        const side = this.acceptOneOf('LEFT', 'RIGHT')
        if (side !== undefined) this.acceptWord('OUTER')
        else this.acceptWord('INNER')
        this.expectWord('JOIN')
        join = side ?? 'INNER'
      } else if (this.acceptWord('STRAIGHT_JOIN')) {
        join = 'STRAIGHT'
      } else {
        const kind = this.acceptOneOf('INNER', 'CROSS', 'LEFT', 'RIGHT')
        if (kind === 'LEFT' || kind === 'RIGHT') this.acceptWord('OUTER')
        if (kind === undefined && !this.isWord('JOIN')) return left
        this.expectWord('JOIN')
        join = kind ?? 'INNER'
      }
      const right = this.#tablePrimary()
      let on: Expression | undefined
      let using: string[] | undefined
      if (!natural) {
        if (this.acceptWord('ON')) on = this.expression()
        else if (this.acceptWord('USING')) using = this.nameList()
        else if (join === 'LEFT' || join === 'RIGHT') this.fail()
      }
      left = {
        kind: 'join',
        join,
        natural,
        left,
        right,
        ...(on === undefined ? {} : { on }),
        ...(using === undefined ? {} : { using }),
        start,
        end: this.last,
      }
    }
  }

  #tablePrimary(): TableRef {
    const start = this.position
    if (this.isOp('(')) {
      if (
        this.isWord('SELECT', 1) ||
        this.isWord('WITH', 1) ||
        (this.isOp('(', 1) && this.#startsQuery(1))
      ) {
        this.next()
        const select = this.select()
        this.expectOp(')')
        this.acceptWord('AS')
        if (!this.isName()) {
          throw new SqlError(1248, '42000', 'Every derived table must have its own alias')
        }
        const alias = this.name()
        const columns = this.isOp('(') ? this.nameList() : undefined
        return {
          kind: 'derived',
          select,
          alias,
          ...(columns === undefined ? {} : { columns }),
          start,
          end: this.last,
        }
      }
      this.next()
      const refs = this.tableRefs()
      this.expectOp(')')
      if (refs.length !== 1) {
        // (t1, t2) joins as t1 CROSS JOIN t2.
        return refs.reduce((left, right) => ({
          kind: 'join',
          join: 'CROSS',
          natural: false,
          left,
          right,
          start,
          end: this.last,
        }))
      }
      return refs[0]!
    }
    const table = this.tableName()
    if (this.acceptWord('PARTITION')) this.nameList()
    let alias: string | undefined
    if (this.acceptWord('AS')) alias = this.name()
    else if (this.isName()) alias = this.name()
    // Hints of indexes change nothing.
    while (this.isWord('USE') || this.isWord('IGNORE') || this.isWord('FORCE')) {
      this.next()
      if (this.acceptOneOf('INDEX', 'KEY') === undefined) this.fail()
      if (this.acceptWord('FOR')) {
        if (this.acceptWord('JOIN')) {
          // FOR JOIN
        } else if (this.acceptOneOf('ORDER', 'GROUP') !== undefined) this.expectWord('BY')
        else this.fail()
      }
      this.expectOp('(')
      if (!this.isOp(')')) {
        do {
          if (!this.acceptWord('PRIMARY')) this.name()
        } while (this.acceptOp(','))
      }
      this.expectOp(')')
    }
    return {
      kind: 'table',
      table,
      ...(alias === undefined ? {} : { alias }),
      start,
      end: this.last,
    }
  }

  /** Whether parentheses that open `offset` tokens on, maybe nested, hold a query. */
  #startsQuery(offset: number): boolean {
    let at = offset
    while (this.isOp('(', at)) at++
    return this.isWord('SELECT', at) || this.isWord('WITH', at)
  }

  // Changes of rows

  #insert(): Insert {
    const start = this.position
    const first = this.next()
    const replace = first.kind === 'word' && first.text.toUpperCase() === 'REPLACE'
    this.acceptOneOf('LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY')
    const ignore = !replace && this.acceptWord('IGNORE')
    this.acceptWord('INTO')
    const table = this.tableName()
    if (this.acceptWord('PARTITION')) this.nameList()
    let columns: string[] | undefined
    if (this.isOp('(') && !this.#startsQuery(1)) {
      this.next()
      columns = []
      if (!this.isOp(')')) {
        do columns.push(this.#columnOfTable())
        while (this.acceptOp(','))
      }
      this.expectOp(')')
    }
    let source: InsertSource
    if (this.acceptOneOf('VALUES', 'VALUE') !== undefined) {
      const rows: Expression[][] = []
      do {
        this.expectOp('(')
        const row: Expression[] = []
        if (!this.isOp(')')) {
          do row.push(this.#valueOrDefault())
          while (this.acceptOp(','))
        }
        this.expectOp(')')
        rows.push(row)
      } while (this.acceptOp(','))
      source = { kind: 'values', rows }
    } else if (columns === undefined && this.acceptWord('SET')) {
      source = { kind: 'set', assignments: this.#assignments() }
    } else if (this.isWord('SELECT') || this.isWord('WITH') || this.isOp('(')) {
      source = { kind: 'select', select: this.select() }
    } else {
      this.fail()
    }
    let onDuplicate: Assignment[] | undefined
    if (!replace && this.acceptWord('ON')) {
      this.expectWord('DUPLICATE', 'KEY', 'UPDATE')
      onDuplicate = this.#assignments()
    }
    const returning = this.#returning()
    return {
      kind: 'insert',
      replace,
      ignore,
      table,
      ...(columns === undefined ? {} : { columns }),
      source,
      ...(onDuplicate === undefined ? {} : { onDuplicate }),
      ...(returning === undefined ? {} : { returning }),
      start,
      end: this.last,
    }
  }

  /** Reads a column that INSERT names, which may be qualified by its table. */
  #columnOfTable(): string {
    let name = this.name()
    while (this.acceptOp('.')) name = this.#qualifier()
    return name
  }

  #returning(): SelectItem[] | undefined {
    if (!this.acceptWord('RETURNING')) return undefined
    const items = [this.#selectItem()]
    while (this.acceptOp(',')) items.push(this.#selectItem())
    return items
  }

  /** Reads a value of a row that INSERT inserts, or DEFAULT. */
  #valueOrDefault(): Expression {
    const token = this.peek()
    if (this.isWord('DEFAULT') && !this.isOp('(', 1)) {
      this.next()
      return { kind: 'default', start: token.start, end: token.end }
    }
    return this.expression()
  }

  #assignments(): Assignment[] {
    const assignments: Assignment[] = []
    do {
      const column = this.columnName()
      this.expectOp('=')
      assignments.push({ column, value: this.#valueOrDefault() })
    } while (this.acceptOp(','))
    return assignments
  }

  /** Reads a column's name, maybe qualified by its table and database. */
  columnName(): ColumnName {
    const first = this.name()
    if (!this.acceptOp('.')) return { name: first }
    const second = this.#qualifier()
    if (!this.acceptOp('.')) return { table: first, name: second }
    return { schema: first, table: second, name: this.#qualifier() }
  }

  #update(): Update {
    const start = this.next().start
    this.acceptWord('LOW_PRIORITY')
    const ignore = this.acceptWord('IGNORE')
    const tables = this.tableRefs()
    this.expectWord('SET')
    const set = this.#assignments()
    const where = this.acceptWord('WHERE') ? this.expression() : undefined
    const orderBy = this.acceptWord('ORDER', 'BY') ? this.orderList() : undefined
    const limit = this.acceptWord('LIMIT') ? this.#limitValue() : undefined
    return {
      kind: 'update',
      ignore,
      tables,
      set,
      ...(where === undefined ? {} : { where }),
      ...(orderBy === undefined ? {} : { orderBy }),
      ...(limit === undefined ? {} : { limit }),
      start,
      end: this.last,
    }
  }

  #delete(): Delete {
    const start = this.next().start
    let ignore = false
    for (;;) {
      const option = this.acceptOneOf('LOW_PRIORITY', 'QUICK', 'IGNORE')
      if (option === undefined) break
      if (option === 'IGNORE') ignore = true
    }
    const targetList = (): TableName[] => {
      const targets: TableName[] = []
      do {
        targets.push(this.tableName())
        if (this.acceptOp('.')) this.expectOp('*')
      } while (this.acceptOp(','))
      return targets
    }
    let targets: TableName[] | undefined
    let from: TableRef[]
    if (this.acceptWord('FROM')) {
      const tableStart = this.position
      const first = this.tableName()
      if (this.isOp('.') || this.isOp(',') || this.isWord('USING')) {
        // DELETE FROM t1, t2 USING ...
        if (this.acceptOp('.')) this.expectOp('*')
        targets = [first]
        while (this.acceptOp(',')) {
          targets.push(this.tableName())
          if (this.acceptOp('.')) this.expectOp('*')
        }
        this.expectWord('USING')
        from = this.tableRefs()
      } else {
        let alias: string | undefined
        if (this.acceptWord('AS')) alias = this.name()
        else if (this.isName()) alias = this.name()
        from = [
          {
            kind: 'table',
            table: first,
            ...(alias === undefined ? {} : { alias }),
            start: tableStart,
            end: this.last,
          },
        ]
      }
    } else {
      targets = targetList()
      this.expectWord('FROM')
      from = this.tableRefs()
    }
    const where = this.acceptWord('WHERE') ? this.expression() : undefined
    const orderBy =
      targets === undefined && this.acceptWord('ORDER', 'BY') ? this.orderList() : undefined
    const limit = targets === undefined && this.acceptWord('LIMIT') ? this.#limitValue() : undefined
    const returning = targets === undefined ? this.#returning() : undefined
    return {
      kind: 'delete',
      ignore,
      ...(targets === undefined ? {} : { targets }),
      from,
      ...(where === undefined ? {} : { where }),
      ...(orderBy === undefined ? {} : { orderBy }),
      ...(limit === undefined ? {} : { limit }),
      ...(returning === undefined ? {} : { returning }),
      start,
      end: this.last,
    }
  }

  // Expressions, by MariaDB's precedence, from the loosest

  expression(): Expression {
    let left = this.#xor()
    while (this.acceptWord('OR') || this.acceptOp('||')) {
      const right = this.#xor()
      left = binary('OR', left, right)
    }
    return left
  }

  #xor(): Expression {
    let left = this.#and()
    while (this.acceptWord('XOR')) left = binary('XOR', left, this.#and())
    return left
  }

  #and(): Expression {
    let left = this.#not()
    while (this.acceptWord('AND') || this.acceptOp('&&')) left = binary('AND', left, this.#not())
    return left
  }

  #not(): Expression {
    const start = this.position
    if (this.acceptWord('NOT')) {
      const operand = this.#not()
      return { kind: 'unary', op: 'NOT', operand, start, end: operand.end }
    }
    return this.#comparison()
  }

  /** Reads comparisons and IS, which the predicates they compare bind more tightly than. */
  #comparison(): Expression {
    let left = this.#predicate()
    for (;;) {
      if (this.isWord('IS')) {
        this.next()
        const not = this.acceptWord('NOT')
        const value = this.acceptOneOf('NULL', 'TRUE', 'FALSE', 'UNKNOWN')
        if (value === undefined) this.fail()
        left = { kind: 'is', operand: left, not, value, start: left.start, end: this.last }
        continue
      }
      const token = this.peek()
      const op = token.kind === 'op' ? COMPARISON_OPERATORS[token.text] : undefined
      if (op === undefined) return left
      this.next()
      const quantifier =
        this.isOp('(', 1) && this.#startsQuery(1)
          ? this.acceptOneOf('ANY', 'SOME', 'ALL')
          : undefined
      if (quantifier !== undefined) {
        this.expectOp('(')
        const select = this.select()
        this.expectOp(')')
        left = {
          kind: 'quantified',
          op,
          all: quantifier === 'ALL',
          operand: left,
          select,
          start: left.start,
          end: this.last,
        }
        continue
      }
      const right = this.#predicate()
      left = binary(op, left, right)
    }
  }

  /** Reads IN, BETWEEN, LIKE and REGEXP, maybe after NOT. */
  #predicate(): Expression {
    const left = this.#bitOr()
    const not =
      this.isWord('NOT') &&
      ['IN', 'BETWEEN', 'LIKE', 'REGEXP', 'RLIKE'].some((word) => this.isWord(word, 1))
    if (not) this.next()
    if (this.acceptWord('IN')) {
      this.expectOp('(')
      if (this.#startsQuery(0)) {
        const select = this.select()
        this.expectOp(')')
        return { kind: 'inSelect', operand: left, not, select, start: left.start, end: this.last }
      }
      const list = [this.expression()]
      while (this.acceptOp(',')) list.push(this.expression())
      this.expectOp(')')
      return { kind: 'in', operand: left, not, list, start: left.start, end: this.last }
    }
    if (this.acceptWord('BETWEEN')) {
      const low = this.#bitOr()
      this.expectWord('AND')
      const high = this.#predicate()
      return { kind: 'between', operand: left, not, low, high, start: left.start, end: high.end }
    }
    if (this.acceptWord('LIKE')) {
      const pattern = this.#bitOr()
      const escape = this.acceptWord('ESCAPE') ? this.#unary() : undefined
      return {
        kind: 'like',
        operand: left,
        not,
        pattern,
        ...(escape === undefined ? {} : { escape }),
        start: left.start,
        end: this.last,
      }
    }
    if (this.acceptOneOf('REGEXP', 'RLIKE') !== undefined) {
      const pattern = this.#bitOr()
      return { kind: 'regexp', operand: left, not, pattern, start: left.start, end: pattern.end }
    }
    if (not) this.fail()
    return left
  }

  #bitOr(): Expression {
    let left = this.#bitAnd()
    while (this.acceptOp('|')) left = binary('|', left, this.#bitAnd())
    return left
  }

  #bitAnd(): Expression {
    let left = this.#shift()
    while (this.acceptOp('&')) left = binary('&', left, this.#shift())
    return left
  }

  #shift(): Expression {
    let left = this.#additive()
    for (;;) {
      if (this.acceptOp('<<')) left = binary('<<', left, this.#additive())
      else if (this.acceptOp('>>')) left = binary('>>', left, this.#additive())
      else return left
    }
  }

  #additive(): Expression {
    let left = this.#multiplicative()
    for (;;) {
      const op = this.isOp('+') ? '+' : this.isOp('-') ? '-' : undefined
      if (op === undefined) return left
      this.next()
      // date + INTERVAL 1 DAY
      const right =
        this.isWord('INTERVAL') && !this.#intervalFunction()
          ? this.#interval()
          : this.#multiplicative()
      left = binary(op, left, right)
    }
  }

  #multiplicative(): Expression {
    let left = this.#bitXor()
    for (;;) {
      let op: BinaryOperator | undefined
      if (this.acceptOp('*')) op = '*'
      else if (this.acceptOp('/')) op = '/'
      else if (this.acceptOp('%') || this.acceptWord('MOD')) op = 'MOD'
      else if (this.acceptWord('DIV')) op = 'DIV'
      if (op === undefined) return left
      left = binary(op, left, this.#bitXor())
    }
  }

  #bitXor(): Expression {
    let left = this.#unary()
    while (this.acceptOp('^')) left = binary('^', left, this.#unary())
    return left
  }

  #unary(): Expression {
    const start = this.position
    const op = this.isOp('-')
      ? '-'
      : this.isOp('+')
        ? '+'
        : this.isOp('~')
          ? '~'
          : this.isOp('!')
            ? '!'
            : undefined
    if (op !== undefined) {
      this.next()
      const operand = this.#unary()
      return { kind: 'unary', op, operand, start, end: operand.end }
    }
    if (this.isWord('BINARY') && !this.isOp('(', 1)) {
      this.next()
      const operand = this.#unary()
      return { kind: 'unary', op: 'BINARY', operand, start, end: operand.end }
    }
    let expr = this.#primary()
    while (this.acceptWord('COLLATE')) {
      const collation = this.nameOrString()
      expr = { kind: 'collate', operand: expr, collation, start, end: this.last }
    }
    return expr
  }

  /** Whether INTERVAL comes next as the function INTERVAL(n, n1, ...), not as an interval. */
  #intervalFunction(): boolean {
    if (!this.isOp('(', 1)) return false
    // INTERVAL (expr) unit is an interval: find the closing parenthesis and see what follows.
    let depth = 0
    for (let offset = 1; ; offset++) {
      const token = this.peek(offset)
      if (token.kind === 'end') return true
      if (token.kind === 'op' && token.text === '(') depth++
      else if (token.kind === 'op' && token.text === ')' && --depth === 0) {
        const after = this.peek(offset + 1)
        return !(after.kind === 'word' && intervalUnit(after.text) !== undefined)
      } else if (token.kind === 'op' && token.text === ',' && depth === 1) return true
    }
  }

  /** Reads INTERVAL expr unit. */
  #interval(): Expression {
    const start = this.position
    this.expectWord('INTERVAL')
    const value = this.expression()
    const token = this.peek()
    const unit = token.kind === 'word' ? intervalUnit(token.text) : undefined
    if (
      unit === undefined ||
      token.kind !== 'word' ||
      token.text.toUpperCase().startsWith('SQL_TSI_')
    )
      this.fail()
    this.next()
    return { kind: 'interval', value, unit, start, end: this.last }
  }

  /** Reads a unit of TIMESTAMPADD, TIMESTAMPDIFF or EXTRACT as a string. */
  #unitArgument(): Expression {
    const token = this.peek()
    const unit = token.kind === 'word' ? intervalUnit(token.text) : undefined
    if (unit === undefined) this.fail()
    this.next()
    return { kind: 'string', text: unit, binary: false, start: token.start, end: token.end }
  }

  /** Reads a literal, a parameter, a variable, a call or a column, or an expression in parentheses. */
  primaryExpression(): Expression {
    return this.#primary()
  }

  #primary(): Expression {
    const token = this.peek()
    const start = token.start
    const at = <T extends ExpressionNode>(node: T): T & { start: number; end: number } => ({
      ...node,
      start,
      end: this.last,
    })
    switch (token.kind) {
      case 'number':
        this.next()
        return at({ kind: 'number', text: token.text })
      case 'string': {
        const text = this.string()
        return at({ kind: 'string', text, binary: false })
      }
      case 'hex':
        this.next()
        return at({ kind: 'hex', digits: token.digits })
      case 'bits':
        this.next()
        return at({ kind: 'bits', digits: token.digits })
      case 'param':
        this.next()
        return at({ kind: 'param', index: this.#params++ })
      case 'variable': {
        this.next()
        if (!token.system && this.acceptOp(':=')) {
          const value = this.expression()
          return at({ kind: 'assign', name: token.text, value })
        }
        const { name, scope } = variableScope(token.text, token.system)
        return at({
          kind: 'variable',
          name,
          system: token.system,
          ...(scope === undefined ? {} : { scope }),
        })
      }
      case 'op':
        if (token.text === '(') {
          if (this.#startsQuery(1)) {
            this.next()
            const select = this.select()
            this.expectOp(')')
            return at({ kind: 'subquery', select })
          }
          this.next()
          const items = [this.expression()]
          while (this.acceptOp(',')) items.push(this.expression())
          this.expectOp(')')
          // MariaDB keeps parentheses in the names of columns, which spans keep.
          return items.length === 1
            ? { ...items[0]!, start, end: this.last }
            : at({ kind: 'row', items })
        }
        this.fail()
      case 'ident':
        return this.#columnOrCall()
      case 'word':
        break
      default:
        this.fail()
    }
    const word = token.text.toUpperCase()
    const next = this.peek(1)
    const call = next.kind === 'op' && next.text === '('
    // Strings that a character set introduces, as _utf8mb4'x' and _binary'x' do, and N'x'.
    if (/^_[A-Za-z0-9]+$/.test(token.text) && (next.kind === 'string' || next.kind === 'hex')) {
      this.next()
      if (next.kind === 'hex') {
        this.next()
        return at({ kind: 'hex', digits: next.digits })
      }
      const text = this.string()
      return at({ kind: 'string', text, binary: word === '_BINARY' })
    }
    if (word === 'N' && next.kind === 'string' && next.start === token.end) {
      this.next()
      return at({ kind: 'string', text: this.string(), binary: false })
    }
    switch (word) {
      case 'NULL':
        this.next()
        return at({ kind: 'null' })
      case 'TRUE':
      case 'FALSE':
        this.next()
        return at({ kind: 'boolean', value: word === 'TRUE' })
      case 'DATE':
      case 'TIME':
      case 'TIMESTAMP':
        if (next.kind === 'string') {
          this.next()
          const text = this.string()
          const type: CastType = { name: word === 'TIMESTAMP' ? 'DATETIME' : word }
          return at({
            kind: 'cast',
            operand: { kind: 'string', text, binary: false, start: next.start, end: this.last },
            type,
          })
        }
        break
      case 'EXISTS': {
        this.next()
        this.expectOp('(')
        const select = this.select()
        this.expectOp(')')
        return at({ kind: 'exists', select })
      }
      case 'CASE':
        return this.#case()
      case 'INTERVAL':
        if (!this.#intervalFunction()) return this.#intervalFirst()
        break
      case 'DEFAULT':
        if (call) {
          this.next()
          this.next()
          const column = this.columnName()
          this.expectOp(')')
          return at({ kind: 'default', column })
        }
        this.fail()
      case 'VALUES':
      case 'VALUE':
        if (call) {
          this.next()
          this.next()
          const column = this.columnName()
          this.expectOp(')')
          return at({ kind: 'values', column })
        }
        if (word === 'VALUES') this.fail()
        break
      case 'ROW':
        if (call) {
          this.next()
          this.next()
          const items = [this.expression()]
          while (this.acceptOp(',')) items.push(this.expression())
          this.expectOp(')')
          return at({ kind: 'row', items })
        }
        break
      case 'MATCH':
        throw unsupported('MATCH ... AGAINST')
    }
    if (word in NILADIC && !call) {
      this.next()
      return at({ kind: 'call', name: NILADIC[word]!, args: [] })
    }
    if (call && (!RESERVED.has(word) || RESERVED_FUNCTIONS.has(word))) return this.#call()
    return this.#columnOrCall()
  }

  /** Reads INTERVAL expr unit + date, which adds the interval as date + INTERVAL expr unit does. */
  #intervalFirst(): Expression {
    const interval = this.#interval()
    if (!this.acceptOp('+')) this.fail()
    const date = this.#multiplicative()
    return binary('+', date, interval, interval.start)
  }

  #case(): Expression {
    const start = this.next().start
    const operand = this.isWord('WHEN') ? undefined : this.expression()
    const whens: { when: Expression; then: Expression }[] = []
    while (this.acceptWord('WHEN')) {
      const when = this.expression()
      this.expectWord('THEN')
      whens.push({ when, then: this.expression() })
    }
    if (whens.length === 0) this.fail()
    const otherwise = this.acceptWord('ELSE') ? this.expression() : undefined
    this.expectWord('END')
    return {
      kind: 'case',
      ...(operand === undefined ? {} : { operand }),
      whens,
      ...(otherwise === undefined ? {} : { else: otherwise }),
      start,
      end: this.last,
    }
  }

  /** Reads a column, maybe qualified, or a call of a function a database qualifies. */
  #columnOrCall(): Expression {
    const start = this.position
    const column = this.columnName()
    if (this.isOp('(')) throw unsupported('stored functions')
    return { kind: 'column', ...column, start, end: this.last }
  }

  #call(): Expression {
    const nameToken = this.next()
    const start = nameToken.start
    const name = (nameToken.kind === 'word' ? nameToken.text : '').toUpperCase()
    this.expectOp('(')
    const done = (
      node: Omit<Extract<ExpressionNode, { kind: 'call' }>, 'kind' | 'name'>,
    ): Expression => {
      this.expectOp(')')
      return { kind: 'call', name, ...node, start, end: this.last }
    }
    switch (name) {
      case 'COUNT':
        if (this.acceptOp('*')) return done({ args: [], star: true })
        if (this.acceptWord('DISTINCT')) {
          const args = [this.expression()]
          while (this.acceptOp(',')) args.push(this.expression())
          return done({ args, distinct: true })
        }
        this.acceptWord('ALL')
        return done({ args: [this.expression()] })
      case 'SUM':
      case 'AVG':
      case 'MIN':
      case 'MAX':
      case 'BIT_AND':
      case 'BIT_OR':
      case 'BIT_XOR':
      case 'STD':
      case 'STDDEV':
      case 'STDDEV_POP':
      case 'STDDEV_SAMP':
      case 'VARIANCE':
      case 'VAR_POP':
      case 'VAR_SAMP':
      case 'JSON_ARRAYAGG':
      case 'JSON_OBJECTAGG': {
        const distinct = this.acceptWord('DISTINCT')
        if (!distinct) this.acceptWord('ALL')
        const args = [this.expression()]
        while (this.acceptOp(',')) args.push(this.expression())
        return done({ args, ...(distinct ? { distinct } : {}) })
      }
      case 'GROUP_CONCAT': {
        const distinct = this.acceptWord('DISTINCT')
        const args = [this.expression()]
        while (this.acceptOp(',')) args.push(this.expression())
        const orderBy = this.acceptWord('ORDER', 'BY') ? this.orderList() : undefined
        const separator = this.acceptWord('SEPARATOR') ? this.string() : undefined
        if (this.acceptWord('LIMIT')) throw unsupported('GROUP_CONCAT ... LIMIT')
        return done({
          args,
          ...(distinct ? { distinct } : {}),
          ...(orderBy === undefined ? {} : { orderBy }),
          ...(separator === undefined ? {} : { separator }),
        })
      }
      case 'CAST': {
        const operand = this.expression()
        this.expectWord('AS')
        const type = this.#castType()
        this.expectOp(')')
        return { kind: 'cast', operand, type, start, end: this.last }
      }
      case 'CONVERT': {
        const operand = this.expression()
        if (this.acceptWord('USING')) {
          const charset = this.nameOrString()
          this.expectOp(')')
          const binary = charset.toLowerCase() === 'binary'
          return binary
            ? { kind: 'cast', operand, type: { name: 'BINARY' }, start, end: this.last }
            : { kind: 'call', name: 'CONVERT_USING', args: [operand], start, end: this.last }
        }
        this.expectOp(',')
        const type = this.#castType()
        this.expectOp(')')
        return { kind: 'cast', operand, type, start, end: this.last }
      }
      case 'POSITION': {
        const needle = this.#bitOr()
        this.expectWord('IN')
        const haystack = this.expression()
        return done({ args: [needle, haystack] })
      }
      case 'SUBSTRING':
      case 'SUBSTR':
      case 'MID': {
        const args = [this.expression()]
        if (this.acceptWord('FROM')) {
          args.push(this.expression())
          if (this.acceptWord('FOR')) args.push(this.expression())
        } else {
          while (this.acceptOp(',')) args.push(this.expression())
        }
        return { kind: 'call', name: 'SUBSTRING', args, ...this.#closeAt(start) }
      }
      case 'TRIM': {
        const side = this.acceptOneOf('BOTH', 'LEADING', 'TRAILING')
        let remove: Expression | undefined
        let subject: Expression
        if (side !== undefined && this.acceptWord('FROM')) {
          subject = this.expression()
        } else {
          const first = this.expression()
          if (this.acceptWord('FROM')) {
            remove = first
            subject = this.expression()
          } else {
            if (side !== undefined) this.fail()
            subject = first
          }
        }
        const sideText: Expression = {
          kind: 'string',
          text: side ?? 'BOTH',
          binary: false,
          start,
          end: start,
        }
        return done({
          args: remove === undefined ? [subject, sideText] : [subject, sideText, remove],
        })
      }
      case 'EXTRACT': {
        const unit = this.#unitArgument()
        this.expectWord('FROM')
        return done({ args: [unit, this.expression()] })
      }
      case 'TIMESTAMPADD':
      case 'TIMESTAMPDIFF': {
        const unit = this.#unitArgument()
        this.expectOp(',')
        const first = this.expression()
        this.expectOp(',')
        return done({ args: [unit, first, this.expression()] })
      }
      case 'DATE_ADD':
      case 'DATE_SUB':
      case 'ADDDATE':
      case 'SUBDATE': {
        const date = this.expression()
        this.expectOp(',')
        const interval =
          this.isWord('INTERVAL') && !this.#intervalFunction()
            ? this.#interval()
            : this.expression()
        return done({ args: [date, interval] })
      }
      case 'CHAR': {
        const args = [this.expression()]
        while (this.acceptOp(',')) args.push(this.expression())
        if (this.acceptWord('USING')) this.nameOrString()
        return done({ args })
      }
      case 'WEIGHT_STRING':
        throw unsupported('WEIGHT_STRING')
    }
    const args: Expression[] = []
    if (!this.isOp(')')) {
      do args.push(this.expression())
      while (this.acceptOp(','))
    }
    this.expectOp(')')
    if (this.isWord('OVER')) throw unsupported('window functions')
    const canonical = NILADIC[name] ?? (name === 'SCHEMA' ? 'DATABASE' : name)
    return { kind: 'call', name: canonical, args, start, end: this.last }
  }

  #closeAt(start: number): { start: number; end: number } {
    this.expectOp(')')
    return { start, end: this.last }
  }

  /** Reads the type of CAST or CONVERT. */
  #castType(): CastType {
    const token = this.next()
    if (token.kind !== 'word') this.fail(token)
    const word = token.text.toUpperCase()
    const length = (): number | undefined => {
      if (!this.acceptOp('(')) return undefined
      const value = this.integer()
      this.expectOp(')')
      return value
    }
    switch (word) {
      case 'SIGNED':
      case 'UNSIGNED':
        this.acceptOneOf('INTEGER', 'INT')
        return { name: word }
      case 'INTEGER':
      case 'INT':
        return { name: 'SIGNED' }
      case 'CHAR':
      case 'CHARACTER':
      case 'NCHAR':
      case 'VARCHAR': {
        const size = length()
        if (this.acceptWord('CHARACTER', 'SET') || this.acceptWord('CHARSET')) this.nameOrString()
        else this.acceptOneOf('ASCII', 'UNICODE')
        return { name: 'CHAR', ...(size === undefined ? {} : { length: size }) }
      }
      case 'BINARY': {
        const size = length()
        return { name: 'BINARY', ...(size === undefined ? {} : { length: size }) }
      }
      case 'DECIMAL':
      case 'DEC':
      case 'NUMERIC':
      case 'FIXED': {
        if (!this.acceptOp('(')) return { name: 'DECIMAL', length: 10, scale: 0 }
        const digits = this.integer()
        const scale = this.acceptOp(',') ? this.integer() : 0
        this.expectOp(')')
        return { name: 'DECIMAL', length: digits, scale }
      }
      case 'DOUBLE':
        this.acceptWord('PRECISION')
        return { name: 'DOUBLE' }
      case 'REAL':
        return { name: 'DOUBLE' }
      case 'FLOAT':
        length()
        return { name: 'FLOAT' }
      case 'DATE':
        return { name: 'DATE' }
      case 'DATETIME':
      case 'TIME': {
        const size = length()
        return { name: word, ...(size === undefined ? {} : { length: size }) }
      }
      case 'JSON':
        return { name: 'JSON' }
      default:
        this.fail(token)
    }
  }
}

/** The name of a variable without its scope, as in @@session.sql_mode, and the scope. */
function variableScope(
  text: string,
  system: boolean,
): { name: string; scope?: 'GLOBAL' | 'SESSION' } {
  if (!system) return { name: text }
  const match = /^(global|session|local)\.(.*)$/i.exec(text)
  if (match === null) return { name: text }
  return { name: match[2]!, scope: match[1]!.toUpperCase() === 'GLOBAL' ? 'GLOBAL' : 'SESSION' }
}

function binary(
  op: BinaryOperator,
  left: Expression,
  right: Expression,
  start = left.start,
): Expression {
  return { kind: 'binary', op, left, right, start, end: Math.max(left.end, right.end) }
}

/**
 * The error for what MariaDB has but FiveRunner's database does not, as
 * MariaDB's error for what it does not support yet, with a message that
 * says it is FiveRunner's.
 */
export function unsupported(what: string): SqlError {
  return new SqlError(1235, '42000', `FiveRunner's database does not support ${what} yet`)
}

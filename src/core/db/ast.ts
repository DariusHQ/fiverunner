/**
 * The statements of MySQL's SQL that FiveRunner's database reads, as
 * trees: those of queries, of changes to rows, of tables and of sessions.
 * Names keep the case they are written in, which MariaDB compares names
 * of columns without, and of tables too on Windows.
 */

/** Where a node is in the SQL: the offsets of its first character and of the one after its last. */
export interface Span {
  readonly start: number
  readonly end: number
}

/** A table, maybe of a database. */
export interface TableName {
  readonly schema?: string
  readonly name: string
}

/** A column, maybe of a table, which may be of a database. */
export interface ColumnName {
  readonly schema?: string
  readonly table?: string
  readonly name: string
}

/** The operators of two operands, by the names FiveRunner gives them. */
export type BinaryOperator =
  | 'OR'
  | 'XOR'
  | 'AND'
  | '='
  | '<=>'
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '|'
  | '&'
  | '<<'
  | '>>'
  | '+'
  | '-'
  | '*'
  | '/'
  | 'DIV'
  | 'MOD'
  | '^'

/** The units of intervals, as DATE_ADD and INTERVAL take them. */
export type IntervalUnit =
  | 'MICROSECOND'
  | 'SECOND'
  | 'MINUTE'
  | 'HOUR'
  | 'DAY'
  | 'WEEK'
  | 'MONTH'
  | 'QUARTER'
  | 'YEAR'
  | 'SECOND_MICROSECOND'
  | 'MINUTE_MICROSECOND'
  | 'MINUTE_SECOND'
  | 'HOUR_MICROSECOND'
  | 'HOUR_SECOND'
  | 'HOUR_MINUTE'
  | 'DAY_MICROSECOND'
  | 'DAY_SECOND'
  | 'DAY_MINUTE'
  | 'DAY_HOUR'
  | 'YEAR_MONTH'

/** The types that CAST and CONVERT convert to. */
export interface CastType {
  readonly name:
    | 'SIGNED'
    | 'UNSIGNED'
    | 'CHAR'
    | 'BINARY'
    | 'DECIMAL'
    | 'DOUBLE'
    | 'FLOAT'
    | 'DATE'
    | 'DATETIME'
    | 'TIME'
    | 'JSON'
  readonly length?: number
  readonly scale?: number
}

/** An ordering by an expression. */
export interface OrderItem {
  readonly expr: Expression
  readonly descending: boolean
}

/** An expression, with where it is in the SQL. */
export type Expression = ExpressionNode & Span

export type ExpressionNode =
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  /** A number as it is written, which says whether it is an integer, a decimal or a double. */
  | { readonly kind: 'number'; readonly text: string }
  /** A string, of bytes when _binary introduces it. */
  | { readonly kind: 'string'; readonly text: string; readonly binary: boolean }
  | { readonly kind: 'hex'; readonly digits: string }
  | { readonly kind: 'bits'; readonly digits: string }
  /** The parameter of the `index`th ? of the statement, from 0. */
  | { readonly kind: 'param'; readonly index: number }
  | ({ readonly kind: 'column' } & ColumnName)
  /** A variable: of users, @name, or of the system, @@name, maybe of a scope. */
  | {
      readonly kind: 'variable'
      readonly name: string
      readonly system: boolean
      readonly scope?: 'GLOBAL' | 'SESSION'
    }
  | {
      readonly kind: 'unary'
      readonly op: '-' | '+' | '~' | 'NOT' | '!' | 'BINARY'
      readonly operand: Expression
    }
  | {
      readonly kind: 'binary'
      readonly op: BinaryOperator
      readonly left: Expression
      readonly right: Expression
    }
  /** expr IS [NOT] NULL, TRUE, FALSE or UNKNOWN. */
  | {
      readonly kind: 'is'
      readonly operand: Expression
      readonly not: boolean
      readonly value: 'NULL' | 'TRUE' | 'FALSE' | 'UNKNOWN'
    }
  | {
      readonly kind: 'in'
      readonly operand: Expression
      readonly not: boolean
      readonly list: readonly Expression[]
    }
  | {
      readonly kind: 'inSelect'
      readonly operand: Expression
      readonly not: boolean
      readonly select: Select
    }
  /** expr = ANY (SELECT ...), and the other comparisons with ANY, SOME or ALL. */
  | {
      readonly kind: 'quantified'
      readonly op: BinaryOperator
      readonly all: boolean
      readonly operand: Expression
      readonly select: Select
    }
  | {
      readonly kind: 'between'
      readonly operand: Expression
      readonly not: boolean
      readonly low: Expression
      readonly high: Expression
    }
  | {
      readonly kind: 'like'
      readonly operand: Expression
      readonly not: boolean
      readonly pattern: Expression
      readonly escape?: Expression
    }
  | {
      readonly kind: 'regexp'
      readonly operand: Expression
      readonly not: boolean
      readonly pattern: Expression
    }
  | {
      readonly kind: 'case'
      readonly operand?: Expression
      readonly whens: readonly { readonly when: Expression; readonly then: Expression }[]
      readonly else?: Expression
    }
  | { readonly kind: 'cast'; readonly operand: Expression; readonly type: CastType }
  /**
   * A call of a function, by its name in upper case, such as COUNT, with
   * what aggregates take: DISTINCT, *, and for GROUP_CONCAT an order and a
   * separator.
   */
  | {
      readonly kind: 'call'
      readonly name: string
      readonly args: readonly Expression[]
      readonly distinct?: boolean
      readonly star?: boolean
      readonly orderBy?: readonly OrderItem[]
      readonly separator?: string
    }
  | { readonly kind: 'interval'; readonly value: Expression; readonly unit: IntervalUnit }
  | { readonly kind: 'exists'; readonly select: Select }
  | { readonly kind: 'subquery'; readonly select: Select }
  | { readonly kind: 'row'; readonly items: readonly Expression[] }
  | { readonly kind: 'collate'; readonly operand: Expression; readonly collation: string }
  /** DEFAULT, for the default of the column a value is for, or DEFAULT(column). */
  | { readonly kind: 'default'; readonly column?: ColumnName }
  /** VALUES(column), the value that INSERT ... ON DUPLICATE KEY UPDATE would have inserted. */
  | { readonly kind: 'values'; readonly column: ColumnName }
  /** @name := expr. */
  | { readonly kind: 'assign'; readonly name: string; readonly value: Expression }

/** What a SELECT selects: an expression, maybe named, or the columns of all tables, or of one. */
export type SelectItem =
  | ({ readonly kind: 'star'; readonly table?: TableName } & Span)
  | ({ readonly kind: 'expr'; readonly expr: Expression; readonly alias?: string } & Span)

/** A table that a query reads from. */
export type TableRef =
  | ({ readonly kind: 'table'; readonly table: TableName; readonly alias?: string } & Span)
  | ({
      readonly kind: 'derived'
      readonly select: Select
      readonly alias: string
      readonly columns?: readonly string[]
    } & Span)
  | ({
      readonly kind: 'join'
      readonly join: 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS' | 'STRAIGHT'
      readonly natural: boolean
      readonly left: TableRef
      readonly right: TableRef
      readonly on?: Expression
      readonly using?: readonly string[]
    } & Span)

/** The rows that LIMIT takes: `count` of them, after `offset`. */
export interface Limit {
  readonly count: Expression
  readonly offset?: Expression
}

/** One SELECT, without set operations. */
export interface SelectCore extends Span {
  readonly kind: 'core'
  readonly distinct: boolean
  readonly calcFoundRows: boolean
  readonly items: readonly SelectItem[]
  /** The tables after FROM, which commas separate. */
  readonly from: readonly TableRef[]
  readonly where?: Expression
  readonly groupBy?: readonly OrderItem[]
  readonly rollup?: boolean
  readonly having?: Expression
}

/** A query: SELECTs, maybe in parentheses, which UNION, EXCEPT and INTERSECT join. */
export type QueryBody =
  | SelectCore
  | ({
      readonly kind: 'union' | 'except' | 'intersect'
      readonly all: boolean
      readonly left: QueryBody
      readonly right: QueryBody
    } & Span)
  | ({ readonly kind: 'parens'; readonly select: Select } & Span)

/** A common table expression of WITH. */
export interface CommonTable {
  readonly name: string
  readonly columns?: readonly string[]
  readonly select: Select
}

export interface Select extends Span {
  readonly kind: 'select'
  readonly with?: { readonly recursive: boolean; readonly tables: readonly CommonTable[] }
  readonly body: QueryBody
  readonly orderBy?: readonly OrderItem[]
  readonly limit?: Limit
  /** FOR UPDATE, LOCK IN SHARE MODE and FOR SHARE, which a database of one connection need not lock for. */
  readonly locking: boolean
}

/** column = expr, of SET and ON DUPLICATE KEY UPDATE. */
export interface Assignment {
  readonly column: ColumnName
  readonly value: Expression
}

/** What INSERT inserts: rows of values, the values of SET, or the rows of a query. */
export type InsertSource =
  | { readonly kind: 'values'; readonly rows: readonly (readonly Expression[])[] }
  | { readonly kind: 'set'; readonly assignments: readonly Assignment[] }
  | { readonly kind: 'select'; readonly select: Select }

export interface Insert extends Span {
  readonly kind: 'insert'
  /** REPLACE, which deletes the rows that new rows duplicate the keys of. */
  readonly replace: boolean
  readonly ignore: boolean
  readonly table: TableName
  readonly columns?: readonly string[]
  readonly source: InsertSource
  readonly onDuplicate?: readonly Assignment[]
  readonly returning?: readonly SelectItem[]
}

export interface Update extends Span {
  readonly kind: 'update'
  readonly ignore: boolean
  readonly tables: readonly TableRef[]
  readonly set: readonly Assignment[]
  readonly where?: Expression
  readonly orderBy?: readonly OrderItem[]
  readonly limit?: Expression
}

export interface Delete extends Span {
  readonly kind: 'delete'
  readonly ignore: boolean
  /** The tables that rows are deleted from, for DELETE t1, t2 FROM ...; the table of FROM otherwise. */
  readonly targets?: readonly TableName[]
  readonly from: readonly TableRef[]
  readonly where?: Expression
  readonly orderBy?: readonly OrderItem[]
  readonly limit?: Expression
  readonly returning?: readonly SelectItem[]
}

/** A type of columns, by its name in upper case, such as VARCHAR. */
export interface DataType {
  readonly name: string
  /** The length of strings, the digits of decimals, the width of integers, or the digits of fractions of seconds. */
  readonly length?: number
  /** The digits after the point of decimals. */
  readonly scale?: number
  readonly unsigned?: boolean
  readonly zerofill?: boolean
  /** The values of ENUM and SET. */
  readonly values?: readonly string[]
  readonly charset?: string
  readonly collation?: string
}

/** How a foreign key acts on the rows that refer to one that is deleted or updated. */
export type ReferenceAction = 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION' | 'SET DEFAULT'

export interface Reference {
  readonly table: TableName
  readonly columns: readonly string[]
  readonly onDelete?: ReferenceAction
  readonly onUpdate?: ReferenceAction
}

/** A column of a key, maybe of a prefix of its values. */
export interface KeyPart {
  readonly column: string
  readonly length?: number
  readonly descending: boolean
}

export interface ColumnDefinition {
  readonly name: string
  readonly type: DataType
  /** NOT NULL makes it false, NULL true; it is undefined when neither is written. */
  readonly nullable?: boolean
  readonly default?: Expression
  readonly onUpdate?: Expression
  readonly autoIncrement: boolean
  readonly key?: 'PRIMARY' | 'UNIQUE'
  readonly comment?: string
  readonly check?: Expression
  readonly references?: Reference
  /** GENERATED ALWAYS AS (expr), and whether it is stored. */
  readonly generated?: { readonly expr: Expression; readonly stored: boolean }
}

export type TableConstraint =
  | {
      readonly kind: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'SPATIAL'
      readonly name?: string
      readonly parts: readonly KeyPart[]
    }
  | {
      readonly kind: 'FOREIGN'
      readonly name?: string
      readonly columns: readonly string[]
      readonly references: Reference
    }
  | { readonly kind: 'CHECK'; readonly name?: string; readonly expr: Expression }

/** The options of tables, such as ENGINE=InnoDB, which FiveRunner keeps but for few. */
export interface TableOptions {
  readonly engine?: string
  readonly charset?: string
  readonly collation?: string
  readonly autoIncrement?: number
  readonly comment?: string
}

export interface CreateTable extends Span {
  readonly kind: 'createTable'
  readonly temporary: boolean
  readonly orReplace: boolean
  readonly ifNotExists: boolean
  readonly table: TableName
  readonly columns: readonly ColumnDefinition[]
  readonly constraints: readonly TableConstraint[]
  readonly options: TableOptions
  readonly like?: TableName
  readonly select?: Select
}

/** Where ALTER TABLE puts a column: first, or after another. */
export type ColumnPosition = { readonly first: true } | { readonly after: string }

export type AlterAction =
  | {
      readonly kind: 'addColumn'
      readonly ifNotExists: boolean
      readonly column: ColumnDefinition
      readonly position?: ColumnPosition
    }
  | {
      readonly kind: 'addConstraint'
      readonly ifNotExists: boolean
      readonly constraint: TableConstraint
    }
  | {
      readonly kind: 'changeColumn'
      readonly ifExists: boolean
      /** The column it changes, which MODIFY names by the column's new definition. */
      readonly name: string
      readonly column: ColumnDefinition
      readonly position?: ColumnPosition
    }
  | { readonly kind: 'alterDefault'; readonly name: string; readonly default?: Expression }
  | { readonly kind: 'dropColumn'; readonly ifExists: boolean; readonly name: string }
  | { readonly kind: 'dropPrimaryKey' }
  | { readonly kind: 'dropIndex'; readonly ifExists: boolean; readonly name: string }
  | { readonly kind: 'dropForeignKey'; readonly ifExists: boolean; readonly name: string }
  | { readonly kind: 'dropConstraint'; readonly ifExists: boolean; readonly name: string }
  | { readonly kind: 'renameTable'; readonly to: TableName }
  | { readonly kind: 'renameColumn'; readonly from: string; readonly to: string }
  | { readonly kind: 'renameIndex'; readonly from: string; readonly to: string }
  | { readonly kind: 'options'; readonly options: TableOptions }
  /** What changes nothing that FiveRunner keeps, such as ENGINE, ALGORITHM or DISABLE KEYS. */
  | { readonly kind: 'none' }

export interface AlterTable extends Span {
  readonly kind: 'alterTable'
  readonly ifExists: boolean
  readonly table: TableName
  readonly actions: readonly AlterAction[]
}

export interface CreateIndex extends Span {
  readonly kind: 'createIndex'
  readonly orReplace: boolean
  readonly ifNotExists: boolean
  readonly unique: boolean
  readonly name: string
  readonly table: TableName
  readonly parts: readonly KeyPart[]
}

export interface DropIndex extends Span {
  readonly kind: 'dropIndex'
  readonly ifExists: boolean
  readonly name: string
  readonly table: TableName
}

export interface DropTable extends Span {
  readonly kind: 'dropTable'
  readonly temporary: boolean
  readonly ifExists: boolean
  readonly tables: readonly TableName[]
}

export interface TruncateTable extends Span {
  readonly kind: 'truncate'
  readonly table: TableName
}

export interface RenameTable extends Span {
  readonly kind: 'renameTable'
  readonly renames: readonly { readonly from: TableName; readonly to: TableName }[]
}

export interface CreateView extends Span {
  readonly kind: 'createView'
  readonly orReplace: boolean
  readonly ifNotExists: boolean
  readonly view: TableName
  readonly columns?: readonly string[]
  readonly select: Select
}

export interface DropView extends Span {
  readonly kind: 'dropView'
  readonly ifExists: boolean
  readonly views: readonly TableName[]
}

/** CREATE DATABASE, DROP DATABASE and USE, for the one database there is. */
export interface DatabaseStatement extends Span {
  readonly kind: 'createDatabase' | 'dropDatabase' | 'use'
  readonly ifExists?: boolean
  readonly ifNotExists?: boolean
  readonly name: string
}

/** What SET sets: a variable of the system or of users, the character set, or a transaction's isolation. */
export type SetItem =
  | {
      readonly kind: 'variable'
      readonly name: string
      readonly system: boolean
      readonly scope?: 'GLOBAL' | 'SESSION'
      /** The value, or undefined for DEFAULT. */
      readonly value?: Expression
    }
  | { readonly kind: 'names'; readonly charset: string; readonly collation?: string }
  | { readonly kind: 'transaction' }

export interface SetStatement extends Span {
  readonly kind: 'set'
  readonly items: readonly SetItem[]
}

export interface Transaction extends Span {
  readonly kind: 'begin' | 'commit' | 'rollback' | 'savepoint' | 'release' | 'rollbackTo'
  readonly savepoint?: string
}

/** What SHOW and DESCRIBE show. */
export type ShowStatement = Span &
  (
    | {
        readonly kind: 'showTables'
        readonly full: boolean
        readonly like?: Expression
        readonly where?: Expression
      }
    | {
        readonly kind: 'showColumns'
        readonly full: boolean
        readonly table: TableName
        readonly like?: Expression
        readonly where?: Expression
      }
    | { readonly kind: 'showIndex'; readonly table: TableName; readonly where?: Expression }
    | { readonly kind: 'showCreateTable'; readonly table: TableName }
    | { readonly kind: 'showDatabases'; readonly like?: Expression }
    | { readonly kind: 'showVariables'; readonly like?: Expression; readonly where?: Expression }
    | { readonly kind: 'showWarnings' }
  )

/** LOCK TABLES, UNLOCK TABLES, and statements on tables such as OPTIMIZE, which change nothing for FiveRunner. */
export interface NoOp extends Span {
  readonly kind: 'noop'
  /** The tables that OPTIMIZE, ANALYZE, CHECK and REPAIR name, and their operation, for the rows they give. */
  readonly maintenance?: { readonly op: string; readonly tables: readonly TableName[] }
}

export interface Do extends Span {
  readonly kind: 'do'
  readonly expressions: readonly Expression[]
}

export type Statement =
  | Select
  | Insert
  | Update
  | Delete
  | CreateTable
  | AlterTable
  | CreateIndex
  | DropIndex
  | DropTable
  | TruncateTable
  | RenameTable
  | CreateView
  | DropView
  | DatabaseStatement
  | SetStatement
  | Transaction
  | ShowStatement
  | NoOp
  | Do

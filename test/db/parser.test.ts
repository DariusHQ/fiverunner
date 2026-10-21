import { describe, expect, it } from 'vitest'

import { lex } from '../../src/core/db/lexer.ts'
import { parseScript, parseStatement } from '../../src/core/db/parser.ts'

/** The kinds and texts of the tokens of SQL. */
function tokens(sql: string): string[] {
  return lex(sql)
    .filter((token) => token.kind !== 'end')
    .map((token) => {
      switch (token.kind) {
        case 'word':
        case 'ident':
        case 'number':
        case 'op':
          return `${token.kind}:${token.text}`
        case 'string':
          return `string:${JSON.stringify(token.text)}`
        case 'hex':
        case 'bits':
          return `${token.kind}:${token.digits}`
        case 'variable':
          return `${token.system ? '@@' : '@'}${token.text}`
        default:
          return token.kind
      }
    })
}

function syntax(near: string, line = 1): string {
  return `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${near}' at line ${line}`
}

describe("MySQL's tokens", () => {
  it('are names, strings, numbers, parameters, variables and operators', () => {
    expect(
      tokens(
        "SELECT `a``b`, 'it''s', \"x\\ny\", 1.5e3, .5, 0x1F, X'0a', b'101', ?, @v, @@session.x, <=>, ->>",
      ),
    ).toEqual([
      'word:SELECT',
      'ident:a`b',
      'op:,',
      `string:"it's"`,
      'op:,',
      'string:"x\\ny"',
      'op:,',
      'number:1.5e3',
      'op:,',
      'number:.5',
      'op:,',
      'hex:1F',
      'op:,',
      'hex:0a',
      'op:,',
      'bits:101',
      'op:,',
      'param',
      'op:,',
      '@v',
      'op:,',
      '@@session.x',
      'op:,',
      'op:<=>',
      'op:,',
      'op:->>',
    ])
  })

  it('keep \\% and \\_ in strings, for LIKE, and read other backslashes as MariaDB does', () => {
    expect(tokens("'a\\%b\\_c\\qd\\0'")).toEqual([`string:${JSON.stringify('a\\%b\\_cqd\0')}`])
  })

  it('skip comments, but run those of /*! and /*M! for versions up to 11.4', () => {
    expect(
      tokens('SELECT 1 -- x\n# y\n/* z */ /*!40101 + 2 */ /*!999999 + 3 */ /*M! + 4 */'),
    ).toEqual(['word:SELECT', 'number:1', 'op:+', 'number:2', 'op:+', 'number:4'])
    // -- starts a comment only before whitespace.
    expect(tokens('SELECT 1--1')).toEqual(['word:SELECT', 'number:1', 'op:-', 'op:-', 'number:1'])
  })

  it('take names that start with digits', () => {
    expect(tokens('SELECT 1st, 2')).toEqual(['word:SELECT', 'word:1st', 'op:,', 'number:2'])
  })

  it('fail as syntax errors for strings and names that do not end', () => {
    expect(() => lex("SELECT 'abc")).toThrow(syntax("'abc"))
    expect(() => lex('SELECT `abc')).toThrow(syntax('`abc'))
    expect(() => lex('SELECT 1 /* x')).toThrow(syntax('/* x'))
  })
})

describe('Statements', () => {
  it('read expressions by the precedence of MariaDB', () => {
    const select = parseStatement('SELECT NOT a = b AND c OR d XOR e, 1 + 2 * 3, - - 4, a || b')
    expect(select.kind).toBe('select')
    const items = select.kind === 'select' && select.body.kind === 'core' ? select.body.items : []
    const shape = (expr: unknown): unknown => {
      const node = expr as Record<string, unknown>
      switch (node.kind) {
        case 'binary':
          return [node.op, shape(node.left), shape(node.right)]
        case 'unary':
          return [node.op, shape(node.operand)]
        case 'column':
          return node.name
        case 'number':
          return Number(node.text)
        default:
          return node.kind
      }
    }
    expect(items.map((item) => (item.kind === 'expr' ? shape(item.expr) : '*'))).toEqual([
      ['OR', ['AND', ['NOT', ['=', 'a', 'b']], 'c'], ['XOR', 'd', 'e']],
      ['+', 1, ['*', 2, 3]],
      ['-', ['-', 4]],
      ['OR', 'a', 'b'],
    ])
  })

  it('fail with the syntax errors of MariaDB, which quote from where reading failed', () => {
    expect(() => parseStatement('SELECT * FORM t')).toThrow(syntax('FORM t'))
    expect(() => parseStatement('SELECT a FORM t')).toThrow(syntax('t'))
    expect(() => parseStatement('SELECT * FROM order')).toThrow(syntax('order'))
    expect(() => parseStatement('INSERT INTO t VALUES (1,')).toThrow(syntax(''))
    expect(() => parseStatement('SELECT 1\nFROM t WHERE')).toThrow(syntax('', 2))
    expect(() => parseStatement('SELECT 1; SELECT 2')).toThrow(syntax('SELECT 2'))
  })

  it('quote up to 80 characters of what follows an error', () => {
    const rest = `${'x'.repeat(100)}`
    expect(() => parseStatement(`SELECT * ${rest}`)).toThrow(syntax(rest.slice(0, 80)))
  })

  it('take reserved words after a dot, as names of columns', () => {
    expect(parseStatement('SELECT t.order, t.key FROM t').kind).toBe('select')
  })

  it('are many in scripts, with the SQL of each', () => {
    const script = parseScript(
      'CREATE TABLE t (a INT);\n\nINSERT INTO t VALUES (1); ;\n/*!40101 SET NAMES utf8 */;',
    )
    expect(
      script.map((entry) => ['statement' in entry && entry.statement.kind, entry.text]),
    ).toEqual([
      ['createTable', 'CREATE TABLE t (a INT)'],
      ['insert', 'INSERT INTO t VALUES (1)'],
      ['set', 'SET NAMES utf8'],
    ])
  })

  it('go on in scripts past statements that fail, which give the errors they give alone', () => {
    const script = parseScript('SELECT 1;\nSELECT 1 2 3;\nNOPE x;SELECT 2')
    expect(
      script.map((entry) => [
        'error' in entry ? entry.error.message : entry.statement.kind,
        entry.text,
        entry.start,
      ]),
    ).toEqual([
      ['select', 'SELECT 1', 0],
      [syntax('2 3'), 'SELECT 1 2 3', 10],
      [syntax('NOPE x'), 'NOPE x', 24],
      ['select', 'SELECT 2', 31],
    ])
  })

  it('read the definitions of tables as MariaDB writes them', () => {
    const create = parseStatement(
      "CREATE TABLE IF NOT EXISTS `t` (`id` int(11) unsigned NOT NULL AUTO_INCREMENT, `n` varchar(50) COLLATE utf8mb4_bin DEFAULT 'x' COMMENT 'name', `at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(), `j` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`j`)), PRIMARY KEY (`id`) USING BTREE, UNIQUE KEY `n` (`n`(10)), CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `u` (`id`) ON DELETE CASCADE) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC",
    )
    expect(create).toMatchObject({
      kind: 'createTable',
      ifNotExists: true,
      table: { name: 't' },
      columns: [
        {
          name: 'id',
          type: { name: 'INT', length: 11, unsigned: true },
          nullable: false,
          autoIncrement: true,
        },
        {
          name: 'n',
          type: { name: 'VARCHAR', length: 50, collation: 'utf8mb4_bin' },
          comment: 'name',
        },
        { name: 'at', type: { name: 'TIMESTAMP' }, nullable: false },
        {
          name: 'j',
          type: { name: 'LONGTEXT', charset: 'utf8mb4', collation: 'utf8mb4_bin' },
        },
      ],
      constraints: [
        { kind: 'PRIMARY', parts: [{ column: 'id' }] },
        { kind: 'UNIQUE', name: 'n', parts: [{ column: 'n', length: 10 }] },
        {
          kind: 'FOREIGN',
          name: 'fk',
          columns: ['id'],
          references: { table: { name: 'u' }, columns: ['id'], onDelete: 'CASCADE' },
        },
      ],
      options: {
        engine: 'InnoDB',
        autoIncrement: 5,
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
      },
    })
  })

  it('fail for what FiveRunner does not support yet, saying so', () => {
    expect(() => parseStatement('CALL proc()')).toThrow(
      "FiveRunner's database does not support stored procedures yet",
    )
    expect(() => parseStatement('SELECT ROW_NUMBER() OVER ()')).toThrow(
      "FiveRunner's database does not support window functions yet",
    )
  })
})

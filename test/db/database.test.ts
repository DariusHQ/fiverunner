import { describe, expect, it } from 'vitest'

import { SqlError } from '../../src/core/db/lexer.ts'
import { connection, database, error, names, NOW, ok, rows, value } from './helpers.ts'

const PLAYERS = `CREATE TABLE IF NOT EXISTS \`players\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`citizenid\` varchar(50) NOT NULL,
  \`name\` varchar(10) NOT NULL,
  \`money\` text NOT NULL,
  \`level\` tinyint(3) unsigned DEFAULT 1,
  \`admin\` tinyint(1) NOT NULL DEFAULT 0,
  \`last_updated\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (\`citizenid\`),
  KEY \`id\` (\`id\`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`

describe('Tables', () => {
  it('are created as MariaDB creates them, which SHOW CREATE TABLE shows', async () => {
    const db = await connection(PLAYERS)
    const [[, create]] = rows(db, 'SHOW CREATE TABLE players') as [[string, string]]
    expect(create).toBe(`CREATE TABLE \`players\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`citizenid\` varchar(50) NOT NULL,
  \`name\` varchar(10) NOT NULL,
  \`money\` text NOT NULL,
  \`level\` tinyint(3) unsigned DEFAULT 1,
  \`admin\` tinyint(1) NOT NULL DEFAULT 0,
  \`last_updated\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (\`citizenid\`),
  KEY \`id\` (\`id\`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  })

  it('keep names in lower case, as MariaDB does on Windows', async () => {
    const db = await connection('CREATE TABLE `Users` (id INT)')
    expect(rows(db, 'SHOW TABLES')).toEqual([['users']])
    expect(rows(db, 'SELECT * FROM USERS')).toEqual([])
  })

  it('name keys that have no names after their first column, as MariaDB does', async () => {
    const db = await connection(
      'CREATE TABLE t (a INT, b INT UNIQUE, KEY (a), KEY (a), UNIQUE (b), CONSTRAINT FOREIGN KEY (a) REFERENCES t (b))',
    )
    expect(rows(db, 'SHOW INDEX FROM t').map((row) => row[2])).toEqual(['b', 'b_2', 'a', 'a_2'])
    const [[, create]] = rows(db, 'SHOW CREATE TABLE t') as [[string, string]]
    expect(create).toContain('CONSTRAINT `t_ibfk_1` FOREIGN KEY (`a`) REFERENCES `t` (`b`)')
  })

  it('fail with the errors of MariaDB for definitions it rejects', async () => {
    const db = await connection(PLAYERS)
    expect(error(db, 'CREATE TABLE players (id INT)')).toBe("Table 'players' already exists")
    expect(error(db, 'CREATE TABLE t (a INT, a INT)')).toBe("Duplicate column name 'a'")
    expect(error(db, 'CREATE TABLE t (a INT PRIMARY KEY, b INT, PRIMARY KEY (b))')).toBe(
      'Multiple primary key defined',
    )
    expect(error(db, 'CREATE TABLE t (a INT AUTO_INCREMENT)')).toBe(
      'Incorrect table definition; there can be only one auto column and it must be defined as a key',
    )
    expect(error(db, 'CREATE TABLE t (a INT, KEY (b))')).toBe(
      "Key column 'b' doesn't exist in table",
    )
    expect(error(db, "CREATE TABLE t (a INT NOT NULL DEFAULT 'x')")).toBe(
      "Invalid default value for 'a'",
    )
    expect(error(db, 'CREATE TABLE t (a INT NOT NULL DEFAULT NULL)')).toBe(
      "Invalid default value for 'a'",
    )
    expect(error(db, 'CREATE TABLE t (a VARCHAR(20000))')).toBe(
      "Column length too big for column 'a' (max = 16383); use BLOB or TEXT instead",
    )
    expect(error(db, 'CREATE TABLE t (a TEXT, KEY (a))')).toBe(
      "BLOB/TEXT column 'a' used in key specification without a key length",
    )
    expect(error(db, 'CREATE TABLE t (a INT, FOREIGN KEY (a) REFERENCES nope (id))')).toBe(
      'Can\'t create table `test`.`t` (errno: 150 "Foreign key constraint is incorrectly formed")',
    )
  })

  it('that exist are created again by IF NOT EXISTS with a note', async () => {
    const db = await connection(PLAYERS)
    expect(ok(db, PLAYERS).warningStatus).toBe(1)
    expect(rows(db, 'SHOW WARNINGS')).toEqual([['Note', 1050, "Table 'players' already exists"]])
  })
})

describe('Inserts', () => {
  it('give columns their defaults, and AUTO_INCREMENT values from the counter', async () => {
    const db = await connection(PLAYERS)
    expect(
      ok(db, "INSERT INTO players (citizenid, name, money) VALUES ('A1', 'Bob', '{}')"),
    ).toEqual({
      affectedRows: 1,
      insertId: 1,
      info: '',
      changedRows: 0,
      warningStatus: 0,
    })
    expect(rows(db, 'SELECT id, level, admin, last_updated FROM players')).toEqual([
      [1, 1, false, NOW],
    ])
    expect(value(db, 'SELECT LAST_INSERT_ID()')).toBe(1)
  })

  it('of many rows say how many, and give the AUTO_INCREMENT value of the first', async () => {
    const db = await connection(PLAYERS)
    const sql =
      "INSERT INTO players (citizenid, name, money) VALUES ('A1', 'a', ''), ('A2', 'b', ''), ('A3', 'c', '')"
    expect(ok(db, sql)).toMatchObject({
      affectedRows: 3,
      insertId: 1,
      info: 'Records: 3  Duplicates: 0  Warnings: 0',
    })
  })

  it('that fail insert nothing, but use up the AUTO_INCREMENT values they took', async () => {
    const db = await connection(PLAYERS)
    expect(
      error(
        db,
        "INSERT INTO players (citizenid, name, money) VALUES ('A1', 'a', ''), ('A2', 'much too long', '')",
      ),
    ).toBe("Data too long for column 'name' at row 2")
    expect(value(db, 'SELECT COUNT(*) FROM players')).toBe(0)
    expect(
      ok(db, "INSERT INTO players (citizenid, name, money) VALUES ('A1', 'a', '')").insertId,
    ).toBe(3)
  })

  it('fail as MariaDB does in strict mode for values that do not fit', async () => {
    const db = await connection(PLAYERS)
    const insert = (columns: string, values: string) =>
      error(
        db,
        `INSERT INTO players (citizenid, name, money${columns}) VALUES ('X', 'x', ''${values})`,
      )
    expect(insert(', level', ', 300')).toBe("Out of range value for column 'level' at row 1")
    expect(insert(', level', ', -1')).toBe("Out of range value for column 'level' at row 1")
    expect(insert(', level', ", 'abc'")).toBe(
      "Incorrect integer value: 'abc' for column `test`.`players`.`level` at row 1",
    )
    expect(insert(', level', ", '5abc'")).toBe("Data truncated for column 'level' at row 1")
    expect(insert(', admin', ', NULL')).toBe("Column 'admin' cannot be null")
    expect(insert(', last_updated', ", 'yesterday'")).toBe(
      "Incorrect datetime value: 'yesterday' for column `test`.`players`.`last_updated` at row 1",
    )
    expect(error(db, "INSERT INTO players (citizenid, name) VALUES ('X', 'x')")).toBe(
      "Field 'money' doesn't have a default value",
    )
    expect(error(db, "INSERT INTO players (citizenid, name) VALUES ('X')")).toBe(
      "Column count doesn't match value count at row 1",
    )
    expect(error(db, "INSERT INTO players (citizenid, nope) VALUES ('X', 1)")).toBe(
      "Unknown column 'nope' in 'field list'",
    )
    expect(error(db, "INSERT INTO players (name, name) VALUES ('X', 'y')")).toBe(
      "Column 'name' specified twice",
    )
  })

  it('that duplicate a unique key fail with the values and the name of the key', async () => {
    const db = await connection(
      PLAYERS,
      "INSERT INTO players (citizenid, name, money) VALUES ('Abc', 'a', '')",
    )
    // utf8mb4_unicode_ci compares without case.
    expect(error(db, "INSERT INTO players (citizenid, name, money) VALUES ('ABC', 'b', '')")).toBe(
      "Duplicate entry 'ABC' for key 'PRIMARY'",
    )
  })

  it('skip rows that duplicate keys with IGNORE, with warnings', async () => {
    const db = await connection(
      PLAYERS,
      "INSERT INTO players (citizenid, name, money) VALUES ('A1', 'a', '')",
    )
    const sql =
      "INSERT IGNORE INTO players (citizenid, name, money) VALUES ('A1', 'b', ''), ('A2', 'c', '')"
    expect(ok(db, sql)).toMatchObject({
      affectedRows: 1,
      insertId: 3,
      info: 'Records: 2  Duplicates: 1  Warnings: 1',
      warningStatus: 1,
    })
    expect(rows(db, 'SHOW WARNINGS')).toEqual([
      ['Warning', 1062, "Duplicate entry 'A1' for key 'PRIMARY'"],
    ])
  })

  it('replace the rows they duplicate with REPLACE, which count as affected', async () => {
    const db = await connection(
      PLAYERS,
      "INSERT INTO players (citizenid, name, money) VALUES ('A1', 'a', '')",
    )
    expect(
      ok(db, "REPLACE INTO players (citizenid, name, money) VALUES ('A1', 'b', '')").affectedRows,
    ).toBe(2)
    expect(rows(db, 'SELECT id, name FROM players')).toEqual([[2, 'b']])
  })

  it('update the rows they duplicate with ON DUPLICATE KEY UPDATE, which VALUES() reads the row of', async () => {
    const db = await connection(
      PLAYERS,
      "INSERT INTO players (citizenid, name, money) VALUES ('A1', 'a', '')",
    )
    const upsert = (name: string) =>
      ok(
        db,
        `INSERT INTO players (citizenid, name, money) VALUES ('A1', '${name}', '') ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      )
    // Updated rows count twice, and rows the update does not change once, as they do with CLIENT_FOUND_ROWS.
    expect(upsert('b')).toMatchObject({ affectedRows: 2, insertId: 1 })
    expect(upsert('b')).toMatchObject({ affectedRows: 1, insertId: 1 })
    expect(value(db, 'SELECT name FROM players')).toBe('b')
    expect(
      ok(
        db,
        "INSERT INTO players (citizenid, name, money) VALUES ('A2', 'c', '') ON DUPLICATE KEY UPDATE name = 'x'",
      ),
    ).toMatchObject({
      affectedRows: 1,
      insertId: 4,
    })
  })

  it('take rows of SET, of queries, DEFAULT, and values that read the columns before them', async () => {
    const db = await connection('CREATE TABLE t (a INT DEFAULT 5, b INT, c VARCHAR(5))')
    ok(db, "INSERT INTO t SET b = 2, c = 'x'")
    ok(db, 'INSERT INTO t (a, b) VALUES (DEFAULT, a + 1)')
    ok(db, 'INSERT INTO t (b, a) VALUES (DEFAULT(a), 1)')
    expect(
      ok(db, 'INSERT INTO t (a, b, c) SELECT a * 10, b, c FROM t WHERE c IS NOT NULL'),
    ).toMatchObject({
      affectedRows: 1,
      info: 'Records: 1  Duplicates: 0  Warnings: 0',
    })
    expect(rows(db, 'SELECT a, b, c FROM t')).toEqual([
      [5, 2, 'x'],
      [5, 6, null],
      [1, 5, null],
      [50, 2, 'x'],
    ])
  })

  it('check foreign keys, with the error MariaDB gives', async () => {
    const db = await connection(
      PLAYERS,
      'CREATE TABLE vehicles (plate VARCHAR(8) PRIMARY KEY, citizenid VARCHAR(50), CONSTRAINT fk_owner FOREIGN KEY (citizenid) REFERENCES players (citizenid) ON DELETE CASCADE)',
    )
    expect(error(db, "INSERT INTO vehicles VALUES ('ABC', 'nobody')")).toBe(
      'Cannot add or update a child row: a foreign key constraint fails (`test`.`vehicles`, CONSTRAINT `fk_owner` FOREIGN KEY (`citizenid`) REFERENCES `players` (`citizenid`) ON DELETE CASCADE)',
    )
    ok(db, "INSERT INTO players (citizenid, name, money) VALUES ('A1', 'a', '')")
    ok(db, "INSERT INTO vehicles VALUES ('ABC', 'A1')")
    ok(db, "DELETE FROM players WHERE citizenid = 'A1'")
    expect(value(db, 'SELECT COUNT(*) FROM vehicles')).toBe(0)
  })
})

describe('Updates', () => {
  it('say the rows they matched and those they changed', async () => {
    const db = await connection(
      PLAYERS,
      "INSERT INTO players (citizenid, name, money) VALUES ('A1', 'a', ''), ('A2', 'b', '')",
    )
    expect(ok(db, "UPDATE players SET name = 'a'")).toEqual({
      affectedRows: 2,
      insertId: 0,
      info: 'Rows matched: 2  Changed: 1  Warnings: 0',
      changedRows: 1,
      warningStatus: 0,
    })
  })

  it('assign columns left to right, reading those assigned before', async () => {
    const db = await connection('CREATE TABLE t (a INT, b INT)', 'INSERT INTO t VALUES (1, 0)')
    ok(db, 'UPDATE t SET a = a + 1, b = a * 10')
    expect(rows(db, 'SELECT a, b FROM t')).toEqual([[2, 20]])
  })

  it('set ON UPDATE CURRENT_TIMESTAMP columns only for rows they change', async () => {
    let now = NOW
    const db = (await database({ clock: () => now })).connect()
    db.query(PLAYERS)
    db.query("INSERT INTO players (citizenid, name, money) VALUES ('A1', 'a', '')")
    now += 60_000
    ok(db, "UPDATE players SET name = 'a'")
    expect(value(db, 'SELECT last_updated FROM players')).toBe(NOW)
    ok(db, "UPDATE players SET name = 'b'")
    expect(value(db, 'SELECT last_updated FROM players')).toBe(NOW + 60_000)
  })

  it('take ORDER BY and LIMIT, and joins of other tables', async () => {
    const db = await connection(
      'CREATE TABLE t (id INT PRIMARY KEY, v INT)',
      'CREATE TABLE u (id INT, w INT)',
      'INSERT INTO t VALUES (1, 0), (2, 0), (3, 0)',
      'INSERT INTO u VALUES (2, 20), (3, 30)',
    )
    expect(ok(db, 'UPDATE t SET v = 1 ORDER BY id DESC LIMIT 2').affectedRows).toBe(2)
    expect(ok(db, 'UPDATE t JOIN u ON u.id = t.id SET t.v = u.w WHERE u.w > 25').affectedRows).toBe(
      1,
    )
    expect(
      ok(db, 'UPDATE t LEFT JOIN u ON u.id = t.id SET t.v = -1 WHERE u.id IS NULL').affectedRows,
    ).toBe(1)
    expect(rows(db, 'SELECT id, v FROM t')).toEqual([
      [1, -1],
      [2, 1],
      [3, 30],
    ])
    expect(error(db, 'UPDATE t JOIN u ON u.id = t.id SET t.v = 1 LIMIT 1')).toBe(
      'Incorrect usage of UPDATE and LIMIT',
    )
  })

  it('fail for values that duplicate keys, or skip their rows with IGNORE', async () => {
    const db = await connection(
      'CREATE TABLE t (id INT PRIMARY KEY)',
      'INSERT INTO t VALUES (1), (2)',
    )
    expect(error(db, 'UPDATE t SET id = 2 WHERE id = 1')).toBe(
      "Duplicate entry '2' for key 'PRIMARY'",
    )
    expect(ok(db, 'UPDATE IGNORE t SET id = id + 1')).toMatchObject({
      affectedRows: 2,
      changedRows: 1,
      warningStatus: 1,
    })
    expect(rows(db, 'SELECT id FROM t')).toEqual([[1], [3]])
  })
})

describe('Deletes', () => {
  it('delete in order up to a limit, from joins, and give rows with RETURNING', async () => {
    const db = await connection(
      'CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(5))',
      'CREATE TABLE u (id INT)',
      "INSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd')",
      'INSERT INTO u VALUES (2)',
    )
    expect(ok(db, 'DELETE FROM t ORDER BY id DESC LIMIT 1').affectedRows).toBe(1)
    expect(ok(db, 'DELETE t FROM t JOIN u ON u.id = t.id').affectedRows).toBe(1)
    expect(rows(db, 'DELETE FROM t WHERE id = 1 RETURNING id, name')).toEqual([[1, 'a']])
    expect(rows(db, 'SELECT id FROM t')).toEqual([[3]])
  })

  it('fail for rows that rows of other tables refer to', async () => {
    const db = await connection(
      'CREATE TABLE p (id INT PRIMARY KEY)',
      'CREATE TABLE c (id INT, CONSTRAINT fk FOREIGN KEY (id) REFERENCES p (id))',
      'INSERT INTO p VALUES (1)',
      'INSERT INTO c VALUES (1)',
    )
    expect(error(db, 'DELETE FROM p')).toBe(
      'Cannot delete or update a parent row: a foreign key constraint fails (`test`.`c`, CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `p` (`id`))',
    )
    expect(error(db, 'TRUNCATE p')).toBe(
      'Cannot truncate a table referenced in a foreign key constraint (`test`.`c`, CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `test`.`p` (`id`))',
    )
  })
})

describe('Queries', () => {
  it('name columns as MariaDB does: by alias, as written, or by the text of the expression', async () => {
    const db = await connection(PLAYERS)
    expect(
      names(db, "SELECT CitizenID, p.name AS n, COUNT( * ), 'text', 1 + 1, (2) FROM players p"),
    ).toEqual(['CitizenID', 'n', 'COUNT( * )', 'text', '1 + 1', '(2)'])
  })

  it('give values the types that mysql2 reads them by', async () => {
    const db = await connection(
      'CREATE TABLE t (d DECIMAL(10,2), f FLOAT, b TINYINT(1), big BIGINT, dt DATETIME, day DATE, tm TIME, j JSON, bl BLOB, vb VARBINARY(4), bit BIT(1))',
      "INSERT INTO t VALUES (12.5, 1.1, 1, 9223372036854775807, '2024-01-02 03:04:05', '2024-01-02', '10:20:30', '{\"a\": 1}', 'ab', 'cd', 1)",
    )
    expect(rows(db, 'SELECT * FROM t')).toEqual([
      [
        '12.50',
        1.1,
        true,
        '9223372036854775807',
        Date.UTC(2024, 0, 2, 3, 4, 5),
        Date.UTC(2024, 0, 2),
        '10:20:30',
        '{"a": 1}',
        [97, 98],
        new Uint8Array([99, 100]),
        true,
      ],
    ])
    // Sums of integers are decimals, as are quotients, which mysql2 reads as strings.
    expect(rows(db, 'SELECT SUM(1), AVG(2), 5 / 2, 1.50, 2.0e0, COUNT(*), 1 = 1')).toEqual([
      ['1', '2.0000', '2.5000', '1.50', 2, 1, 1],
    ])
  })

  it('read values with execute as mysql2 reads MariaDB binary protocol, as oxmysql patches it', async () => {
    const db = await connection(
      'CREATE TABLE t (b TINYINT(1), bl BLOB, f FLOAT)',
      "INSERT INTO t VALUES (1, 'ab', 1.1)",
    )
    expect(rows(db, 'SELECT b, bl, f FROM t WHERE b = ?', [1])).toEqual([
      [1, [97, 98], Math.fround(1.1)],
    ])
  })

  it('compare strings without case, accents and trailing spaces, but those of binary collations', async () => {
    const db = await connection()
    expect(
      rows(
        db,
        "SELECT 'Élan' = 'elan ', 'a' = 'A' COLLATE utf8mb4_bin, BINARY 'a' = 'A', 'b' > 'A', 'abc' LIKE 'A%', 'abc ' LIKE 'abc'",
      ),
    ).toEqual([[1, 0, 0, 1, 1, 0]])
  })

  it('compare numbers with strings as numbers, and dates with strings as dates', async () => {
    const db = await connection(
      'CREATE TABLE t (s VARCHAR(5), d DATETIME)',
      "INSERT INTO t VALUES ('10', '2024-01-01 00:00:00')",
    )
    expect(
      rows(db, "SELECT s > 9, s = 10.0, d = '2024-01-01', d > '2023-12-31 23:59:59' FROM t"),
    ).toEqual([[1, 1, 1, 1]])
  })

  it('resolve names as MariaDB does, with its errors', async () => {
    const db = await connection(PLAYERS, 'CREATE TABLE bans (id INT, citizenid VARCHAR(50))')
    expect(error(db, 'SELECT nope FROM players')).toBe("Unknown column 'nope' in 'field list'")
    expect(error(db, 'SELECT * FROM players WHERE nope = 1')).toBe(
      "Unknown column 'nope' in 'where clause'",
    )
    expect(error(db, 'SELECT * FROM players ORDER BY p.id')).toBe(
      "Unknown column 'p.id' in 'order clause'",
    )
    expect(error(db, 'SELECT id FROM players JOIN bans USING (citizenid)')).toBe(
      "Column 'id' in field list is ambiguous",
    )
    expect(error(db, 'SELECT * FROM nope')).toBe("Table 'test.nope' doesn't exist")
    expect(error(db, 'SELECT NOPE(1)')).toBe('FUNCTION test.NOPE does not exist')
    expect(error(db, 'SELECT LEFT(1)')).toBe(
      "Incorrect parameter count in the call to native function 'LEFT'",
    )
    expect(error(db, 'SELECT * FROM players WHERE COUNT(*) > 1')).toBe(
      'Invalid use of group function',
    )
    expect(error(db, 'SELECT * FROM (SELECT 1)')).toBe(
      'Every derived table must have its own alias',
    )
  })

  it('take aliases in ORDER BY, GROUP BY and HAVING, and positions', async () => {
    const db = await connection(
      'CREATE TABLE t (a INT, b VARCHAR(5))',
      "INSERT INTO t VALUES (1, 'x'), (2, 'x'), (3, 'y')",
    )
    expect(rows(db, 'SELECT b AS k, COUNT(*) AS c FROM t GROUP BY k HAVING c > 1')).toEqual([
      ['x', 2],
    ])
    expect(rows(db, 'SELECT a * -1 AS n FROM t ORDER BY n')).toEqual([[-3], [-2], [-1]])
    expect(rows(db, 'SELECT a, b FROM t ORDER BY 2 DESC, 1 LIMIT 1, 1')).toEqual([[1, 'x']])
  })

  it('join tables, with the columns of USING once in *', async () => {
    const db = await connection(
      'CREATE TABLE a (id INT, x INT)',
      'CREATE TABLE b (id INT, y INT)',
      'INSERT INTO a VALUES (1, 10), (2, 20)',
      'INSERT INTO b VALUES (1, 100)',
    )
    expect(names(db, 'SELECT * FROM a JOIN b USING (id)')).toEqual(['id', 'x', 'y'])
    expect(rows(db, 'SELECT * FROM a LEFT JOIN b USING (id) ORDER BY id')).toEqual([
      [1, 10, 100],
      [2, 20, null],
    ])
    expect(rows(db, 'SELECT a.x, b.y FROM a, b WHERE a.id = b.id')).toEqual([[10, 100]])
  })

  it('take subqueries, unions, common tables, derived tables and views', async () => {
    const db = await connection(
      'CREATE TABLE t (a INT)',
      'INSERT INTO t VALUES (1), (2), (3)',
      'CREATE VIEW big AS SELECT a FROM t WHERE a > 1',
    )
    expect(value(db, 'SELECT (SELECT MAX(a) FROM t)')).toBe(3)
    expect(
      rows(db, 'SELECT a FROM t WHERE a IN (SELECT a FROM big) AND EXISTS (SELECT 1 FROM t)'),
    ).toEqual([[2], [3]])
    expect(rows(db, 'SELECT a FROM t UNION SELECT 5 ORDER BY a DESC LIMIT 2')).toEqual([[5], [3]])
    expect(
      rows(
        db,
        'WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4) SELECT GROUP_CONCAT(i) FROM n',
      ),
    ).toEqual([['1,2,3,4']])
    expect(rows(db, 'SELECT s.total FROM (SELECT SUM(a) AS total FROM big) AS s')).toEqual([['5']])
  })

  it('give the rows of SQL_CALC_FOUND_ROWS to FOUND_ROWS()', async () => {
    const db = await connection('CREATE TABLE t (a INT)', 'INSERT INTO t VALUES (1), (2), (3)')
    rows(db, 'SELECT SQL_CALC_FOUND_ROWS a FROM t LIMIT 1')
    expect(value(db, 'SELECT FOUND_ROWS()')).toBe(3)
  })

  it('fail for SQL that MariaDB cannot read, quoting it from where it could not', async () => {
    const db = await connection()
    expect(error(db, 'SELECT * FORM players')).toBe(
      "You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near 'FORM players' at line 1",
    )
    expect(error(db, 'SELECT 1;\nSELECT 2')).toBe(
      "You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near 'SELECT 2' at line 2",
    )
    expect(error(db, '')).toBe('Query was empty')
  })

  it('fail with SqlErrors that have MariaDB numbers and SQL states', async () => {
    const db = await connection()
    try {
      db.query('SELECT * FROM nope')
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(SqlError)
      expect(thrown).toMatchObject({ errno: 1146, sqlState: '42S02' })
    }
  })
})

describe('Prepared statements', () => {
  it('bind values to their parameters, LIMIT too', async () => {
    const db = await connection('CREATE TABLE t (a INT)', 'INSERT INTO t VALUES (1), (2), (3)')
    expect(rows(db, 'SELECT a FROM t WHERE a > ? ORDER BY a LIMIT ?', [1, 1])).toEqual([[2]])
    expect(error(db, 'SELECT ?', [1, 2])).toBe('Incorrect arguments to mysqld_stmt_execute')
  })
})

describe('Transactions', () => {
  it('commit and roll back, with savepoints', async () => {
    const db = await connection('CREATE TABLE t (a INT)')
    db.query('BEGIN')
    db.query('INSERT INTO t VALUES (1)')
    db.query('SAVEPOINT one')
    db.query('INSERT INTO t VALUES (2)')
    db.query('ROLLBACK TO SAVEPOINT one')
    db.query('COMMIT')
    db.query('START TRANSACTION')
    db.query('INSERT INTO t VALUES (3)')
    db.query('ROLLBACK')
    expect(rows(db, 'SELECT a FROM t')).toEqual([[1]])
  })

  it('open by themselves with autocommit off, which turning it on commits', async () => {
    const db = await connection('CREATE TABLE t (a INT)', 'SET autocommit = 0')
    db.query('INSERT INTO t VALUES (1)')
    db.query('ROLLBACK')
    db.query('INSERT INTO t VALUES (2)')
    db.query('SET autocommit = 1')
    db.query('ROLLBACK')
    expect(rows(db, 'SELECT a FROM t')).toEqual([[2]])
  })

  it('are committed by statements that change tables', async () => {
    const db = await connection(
      'CREATE TABLE t (a INT)',
      'BEGIN',
      'INSERT INTO t VALUES (1)',
      'CREATE TABLE u (b INT)',
      'ROLLBACK',
    )
    expect(rows(db, 'SELECT a FROM t')).toEqual([[1]])
  })

  it('keep other connections out until they end', async () => {
    const db = await database()
    const a = db.connect()
    const b = db.connect()
    a.query('CREATE TABLE t (x INT)')
    a.query('BEGIN')
    expect(() => b.query('SELECT 1')).toThrow(
      'Connection 2 ran a statement while connection 1 had a transaction open',
    )
    a.query('COMMIT')
    expect(b.query('SELECT 1').kind).toBe('rows')
  })
})

describe('ALTER TABLE', () => {
  it('adds, changes, drops and renames columns, converting the values rows have', async () => {
    const db = await connection(
      'CREATE TABLE t (id INT PRIMARY KEY, n VARCHAR(10), p DECIMAL(5,1))',
      "INSERT INTO t VALUES (1, 'abc', 1.5)",
    )
    db.query(
      "ALTER TABLE t ADD COLUMN note VARCHAR(5) NOT NULL DEFAULT 'x' AFTER id, MODIFY p DECIMAL(6,3), CHANGE n name VARCHAR(20)",
    )
    expect(names(db, 'SELECT * FROM t')).toEqual(['id', 'note', 'name', 'p'])
    expect(rows(db, 'SELECT * FROM t')).toEqual([[1, 'x', 'abc', '1.500']])
    db.query('ALTER TABLE t DROP COLUMN note, RENAME COLUMN name TO title, RENAME TO u')
    expect(rows(db, 'SELECT * FROM u')).toEqual([[1, 'abc', '1.500']])
  })

  it('fails for values that no longer fit, and for unique keys that rows duplicate', async () => {
    const db = await connection(
      'CREATE TABLE t (n VARCHAR(10))',
      "INSERT INTO t VALUES ('abc'), ('abc')",
    )
    expect(error(db, 'ALTER TABLE t MODIFY n VARCHAR(2)')).toBe(
      "Data truncated for column 'n' at row 1",
    )
    expect(error(db, 'ALTER TABLE t ADD UNIQUE KEY un (n)')).toBe(
      "Duplicate entry 'abc' for key 'un'",
    )
    expect(error(db, 'ALTER TABLE t DROP COLUMN nope')).toBe(
      "Can't DROP COLUMN `nope`; check that it exists",
    )
  })

  it('adds and drops indexes, which CREATE INDEX and DROP INDEX do too', async () => {
    const db = await connection('CREATE TABLE t (a INT, b INT)')
    db.query('ALTER TABLE t ADD INDEX ia (a), ADD UNIQUE (b)')
    db.query('CREATE INDEX ib ON t (a, b)')
    db.query('DROP INDEX ia ON t')
    expect(rows(db, 'SHOW INDEX FROM t').map((row) => [row[2], row[4]])).toEqual([
      ['b', 'b'],
      ['ib', 'a'],
      ['ib', 'b'],
    ])
  })
})

describe('Information about tables', () => {
  it('is in SHOW and information_schema', async () => {
    const db = await connection(PLAYERS)
    expect(rows(db, "SHOW TABLES LIKE 'play%'")).toEqual([['players']])
    expect(rows(db, "SHOW COLUMNS FROM players LIKE 'admin'")).toEqual([
      ['admin', 'tinyint(1)', 'NO', '', '0', ''],
    ])
    expect(
      value(
        db,
        "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'players'",
      ),
    ).toBe(1)
    expect(
      rows(
        db,
        "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_NAME = 'players' AND COLUMN_NAME IN ('id', 'citizenid')",
      ),
    ).toEqual([
      ['id', 'int', 'NO', 'MUL'],
      ['citizenid', 'varchar', 'NO', 'PRI'],
    ])
    expect(
      value(
        db,
        "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_NAME = 'players' AND SUB_PART IS NULL",
      ),
    ).toBe(2)
  })
})

describe('Variables', () => {
  it('of users keep values, and those of the system are MariaDB settings', async () => {
    const db = await connection()
    db.query('SET @a = 5')
    expect(rows(db, 'SELECT @a, @a := @a + 1, @a, @@autocommit, @@version, DATABASE()')).toEqual([
      [5, 6, 6, 1, '11.4.0-MariaDB-FiveRunner', 'test'],
    ])
    expect(error(db, 'SET nope = 1')).toBe("Unknown system variable 'nope'")
  })

  it('set the time zone of NOW()', async () => {
    const db = await connection("SET time_zone = '+02:00'")
    expect(rows(db, "SELECT DATE_FORMAT(NOW(), '%H:%i')")).toEqual([['09:08']])
    expect(error(db, "SET time_zone = 'Mars/Olympus'")).toBe(
      "Unknown or incorrect time zone: 'Mars/Olympus'",
    )
  })

  it('turn strict mode off by sql_mode, which stores values that do not fit as near as they fit', async () => {
    const db = await connection('CREATE TABLE t (a TINYINT, b VARCHAR(2))', "SET sql_mode = ''")
    expect(ok(db, "INSERT INTO t VALUES (500, 'abc')").warningStatus).toBe(2)
    expect(rows(db, 'SELECT a, b FROM t')).toEqual([[127, 'ab']])
  })
})

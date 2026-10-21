/**
 * JSON as MariaDB's functions have it: documents are text, which they read
 * where they need, and change as text. A value they extract is its text in
 * the document, values they build are written with a space after each
 * colon and comma, as in {"a": 1, "b": [1, 2]}, and those they change keep
 * the rest of the document as it was.
 */

/** A value of a JSON document, with where it is in the text. */
export type JsonNode = (
  | {
      readonly kind: 'object'
      readonly members: readonly {
        readonly key: string
        readonly keyStart: number
        readonly value: JsonNode
      }[]
    }
  | { readonly kind: 'array'; readonly items: readonly JsonNode[] }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'true' | 'false' | 'null' }
) & { readonly start: number; readonly end: number }

/** Thrown for text that is no JSON. */
export class JsonSyntaxError extends Error {
  override readonly name = 'JsonSyntaxError'
  readonly position: number

  constructor(position: number) {
    super(`Syntax error in JSON text at position ${position}`)
    this.position = position
  }
}

const WHITESPACE = /[ \t\n\r]/

/** Reads a JSON document, as strict JSON, with where each value is. */
function parseJson(text: string): JsonNode {
  let at = 0
  const fail = (): never => {
    throw new JsonSyntaxError(at)
  }
  const skip = () => {
    while (at < text.length && WHITESPACE.test(text[at]!)) at++
  }
  const string = (): string => {
    at++
    let value = ''
    for (;;) {
      if (at >= text.length) fail()
      const char = text[at]!
      if (char === '"') {
        at++
        return value
      }
      if (char === '\\') {
        const next = text[at + 1]
        const simple: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        }
        if (next !== undefined && next in simple) {
          value += simple[next]
          at += 2
        } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6))) {
          value += String.fromCharCode(Number.parseInt(text.slice(at + 2, at + 6), 16))
          at += 6
        } else fail()
      } else if (char < ' ') {
        fail()
      } else {
        value += char
        at++
      }
    }
  }
  const value = (): JsonNode => {
    skip()
    const start = at
    const char = text[at]
    if (char === '{') {
      at++
      const members: { key: string; keyStart: number; value: JsonNode }[] = []
      skip()
      if (text[at] === '}') {
        at++
        return { kind: 'object', members, start, end: at }
      }
      for (;;) {
        skip()
        if (text[at] !== '"') fail()
        const keyStart = at
        const key = string()
        skip()
        if (text[at] !== ':') fail()
        at++
        members.push({ key, keyStart, value: value() })
        skip()
        if (text[at] === ',') {
          at++
          continue
        }
        if (text[at] === '}') {
          at++
          return { kind: 'object', members, start, end: at }
        }
        fail()
      }
    }
    if (char === '[') {
      at++
      const items: JsonNode[] = []
      skip()
      if (text[at] === ']') {
        at++
        return { kind: 'array', items, start, end: at }
      }
      for (;;) {
        items.push(value())
        skip()
        if (text[at] === ',') {
          at++
          continue
        }
        if (text[at] === ']') {
          at++
          return { kind: 'array', items, start, end: at }
        }
        fail()
      }
    }
    if (char === '"') {
      const parsed = string()
      return { kind: 'string', value: parsed, start, end: at }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at))
    if (number !== null && number[0] !== '' && number[0] !== '-') {
      at += number[0].length
      return { kind: 'number', value: Number(number[0]), start, end: at }
    }
    for (const word of ['true', 'false', 'null'] as const) {
      if (text.startsWith(word, at)) {
        at += word.length
        return { kind: word, start, end: at }
      }
    }
    return fail()
  }
  const root = value()
  skip()
  if (at !== text.length) fail()
  return root
}

/** The document of a text, or undefined if it is no JSON. */
export function tryParseJson(text: string): JsonNode | undefined {
  try {
    return parseJson(text)
  } catch (error) {
    if (error instanceof JsonSyntaxError) return undefined
    throw error
  }
}

/** A step of a path: a member by name or any, an item by index or any, or any descendant. */
export type PathStep =
  | { readonly kind: 'member'; readonly key: string }
  | { readonly kind: 'anyMember' }
  | { readonly kind: 'item'; readonly index: number; readonly fromEnd: boolean }
  | { readonly kind: 'anyItem' }
  | { readonly kind: 'descendants' }

export interface JsonPath {
  readonly steps: readonly PathStep[]
  /** Whether the path has wildcards, which make it match any number of values. */
  readonly wildcard: boolean
}

/**
 * Reads a path of JSON, as MariaDB's functions take them: $ for the
 * document, then .name or ."name" for members, [n], [last] and [last-n]
 * for items, .* and [*] for any, and ** for any descendant. Gives
 * undefined for what is no path.
 */
export function parseJsonPath(text: string): JsonPath | undefined {
  let at = 0
  const skip = () => {
    while (at < text.length && /\s/.test(text[at]!)) at++
  }
  skip()
  // MariaDB takes lax and strict before the path, which change nothing here.
  const mode = /^(lax|strict)\s+/i.exec(text.slice(at))
  if (mode !== null) at += mode[0].length
  if (text[at] !== '$') return undefined
  at++
  const steps: PathStep[] = []
  let wildcard = false
  for (;;) {
    skip()
    if (at >= text.length) break
    const char = text[at]!
    if (char === '.') {
      at++
      skip()
      if (text[at] === '*') {
        at++
        steps.push({ kind: 'anyMember' })
        wildcard = true
      } else if (text[at] === '"') {
        let key = ''
        at++
        while (at < text.length && text[at] !== '"') {
          if (text[at] === '\\' && at + 1 < text.length) at++
          key += text[at]
          at++
        }
        if (text[at] !== '"') return undefined
        at++
        steps.push({ kind: 'member', key })
      } else {
        const match = /^[A-Za-z_$][A-Za-z0-9_$]*|^[^\s.[\]*"]+/.exec(text.slice(at))
        if (match === null) return undefined
        at += match[0].length
        steps.push({ kind: 'member', key: match[0] })
      }
    } else if (char === '[') {
      at++
      skip()
      if (text[at] === '*') {
        at++
        steps.push({ kind: 'anyItem' })
        wildcard = true
      } else {
        const match = /^(?:(last)\s*(?:-\s*(\d+))?|(\d+))/.exec(text.slice(at))
        if (match === null) return undefined
        at += match[0].length
        if (match[1] !== undefined)
          steps.push({ kind: 'item', index: Number(match[2] ?? 0), fromEnd: true })
        else steps.push({ kind: 'item', index: Number(match[3]), fromEnd: false })
      }
      skip()
      if (text[at] !== ']') return undefined
      at++
    } else if (text.startsWith('**', at)) {
      at += 2
      // ** must be followed by a step.
      steps.push({ kind: 'descendants' })
      wildcard = true
    } else return undefined
  }
  if (steps.at(-1)?.kind === 'descendants') return undefined
  return { steps, wildcard }
}

/** The values of a document that a path matches, in the order of the document. */
export function matchPath(node: JsonNode, path: JsonPath): JsonNode[] {
  let current: JsonNode[] = [node]
  for (const step of path.steps) {
    const next: JsonNode[] = []
    for (const value of current) {
      switch (step.kind) {
        case 'member':
          if (value.kind === 'object') {
            const member = value.members.find((candidate) => candidate.key === step.key)
            if (member !== undefined) next.push(member.value)
          }
          break
        case 'anyMember':
          if (value.kind === 'object') for (const member of value.members) next.push(member.value)
          break
        case 'item': {
          // Paths of arrays address other values as arrays of one.
          const items = value.kind === 'array' ? value.items : [value]
          const index = step.fromEnd ? items.length - 1 - step.index : step.index
          const item = items[index]
          if (item !== undefined) next.push(item)
          break
        }
        case 'anyItem':
          if (value.kind === 'array') next.push(...value.items)
          break
        case 'descendants': {
          const visit = (descendant: JsonNode) => {
            next.push(descendant)
            if (descendant.kind === 'object')
              for (const member of descendant.members) visit(member.value)
            if (descendant.kind === 'array') for (const item of descendant.items) visit(item)
          }
          visit(value)
          break
        }
      }
    }
    current = next
  }
  return current
}

/** A string as JSON writes it, with quotes and escapes. */
export function quoteJson(text: string): string {
  let quoted = '"'
  for (const char of text) {
    switch (char) {
      case '"':
        quoted += '\\"'
        break
      case '\\':
        quoted += '\\\\'
        break
      case '\n':
        quoted += '\\n'
        break
      case '\r':
        quoted += '\\r'
        break
      case '\t':
        quoted += '\\t'
        break
      case '\b':
        quoted += '\\b'
        break
      case '\f':
        quoted += '\\f'
        break
      default:
        quoted += char < ' ' ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}` : char
    }
  }
  return `${quoted}"`
}

/** The text of a node in its document. */
export function nodeText(document: string, node: JsonNode): string {
  return document.slice(node.start, node.end)
}

/** A node's value written anew, as MariaDB writes the values it builds: {"a": 1, "b": [1, 2]}. */
export function writeNode(document: string, node: JsonNode): string {
  switch (node.kind) {
    case 'object':
      return `{${node.members.map((member) => `${quoteJson(member.key)}: ${writeNode(document, member.value)}`).join(', ')}}`
    case 'array':
      return `[${node.items.map((item) => writeNode(document, item)).join(', ')}]`
    case 'string':
      return quoteJson(node.value)
    default:
      return nodeText(document, node)
  }
}

/** The text of a string's value, or a document's own text for other values, as JSON_UNQUOTE gives it. */
export function unquoteJson(text: string): string {
  const node = text.startsWith('"') ? tryParseJson(text) : undefined
  return node?.kind === 'string' ? node.value : text
}

/** The type of a value, as JSON_TYPE names them. */
export function jsonType(document: string, node: JsonNode): string {
  switch (node.kind) {
    case 'object':
      return 'OBJECT'
    case 'array':
      return 'ARRAY'
    case 'string':
      return 'STRING'
    case 'number':
      return /[.eE]/.test(nodeText(document, node)) ? 'DOUBLE' : 'INTEGER'
    case 'true':
    case 'false':
      return 'BOOLEAN'
    case 'null':
      return 'NULL'
  }
}

/** How deep a value is, as JSON_DEPTH counts: 1 for scalars and empty values. */
export function jsonDepth(node: JsonNode): number {
  if (node.kind === 'object' && node.members.length > 0)
    return 1 + Math.max(...node.members.map((member) => jsonDepth(member.value)))
  if (node.kind === 'array' && node.items.length > 0)
    return 1 + Math.max(...node.items.map(jsonDepth))
  return 1
}

/** Whether a value contains another, as JSON_CONTAINS has it: members and items of the candidate are in the target's. */
export function jsonContains(
  document: string,
  target: JsonNode,
  candidateText: string,
  candidate: JsonNode,
): boolean {
  if (target.kind === 'object') {
    if (candidate.kind !== 'object') return false
    return candidate.members.every((member) => {
      const found = target.members.find((existing) => existing.key === member.key)
      return found !== undefined && jsonContains(document, found.value, candidateText, member.value)
    })
  }
  if (target.kind === 'array') {
    if (candidate.kind === 'array') {
      return candidate.items.every((item) =>
        target.items.some((existing) => jsonContains(document, existing, candidateText, item)),
      )
    }
    return target.items.some((existing) =>
      jsonContains(document, existing, candidateText, candidate),
    )
  }
  return jsonEquals(document, target, candidateText, candidate)
}

/** Whether two scalar values are equal: numbers by value, strings by text. */
function jsonEquals(aText: string, a: JsonNode, bText: string, b: JsonNode): boolean {
  if (a.kind === 'number' && b.kind === 'number') return a.value === b.value
  if (a.kind === 'string' && b.kind === 'string') return a.value === b.value
  if (a.kind === 'object' || a.kind === 'array' || b.kind === 'object' || b.kind === 'array') {
    return writeNode(aText, a) === writeNode(bText, b)
  }
  return a.kind === b.kind
}

/**
 * A change of a document: JSON_SET sets values whether they exist or not,
 * JSON_INSERT only those that do not, and JSON_REPLACE only those that do.
 */
export type JsonChange = 'set' | 'insert' | 'replace'

/**
 * Changes a document's value at a path, as JSON_SET, JSON_INSERT and
 * JSON_REPLACE do, by its text: a value that exists is replaced where it
 * is; a member that does not is added at the end of its object; an item
 * past the end of an array is added at its end; and an item of a value
 * that is no array makes it the first of an array. Paths with wildcards
 * fail, and gives undefined; paths whose parents do not exist change
 * nothing.
 */
export function changeJson(
  document: string,
  path: JsonPath,
  value: string,
  change: JsonChange,
): string | undefined {
  if (path.wildcard) return undefined
  const root = parseJson(document)
  if (path.steps.length === 0) return change === 'insert' ? document : value
  const parentPath: JsonPath = { steps: path.steps.slice(0, -1), wildcard: false }
  const [parent] = matchPath(root, parentPath)
  if (parent === undefined) return document
  const last = path.steps.at(-1)!
  const splice = (start: number, end: number, text: string) =>
    document.slice(0, start) + text + document.slice(end)
  if (last.kind === 'member') {
    if (parent.kind !== 'object') return document
    const member = parent.members.find((candidate) => candidate.key === last.key)
    if (member !== undefined) {
      if (change === 'insert') return document
      return splice(member.value.start, member.value.end, value)
    }
    if (change === 'replace') return document
    const addition = `${quoteJson(last.key)}: ${value}`
    if (parent.members.length === 0) return splice(parent.start, parent.end, `{${addition}}`)
    const end = parent.members.at(-1)!.value.end
    return splice(end, end, `, ${addition}`)
  }
  if (last.kind === 'item') {
    if (parent.kind !== 'array') {
      // [0] of a value that is no array is the value itself.
      const index = last.fromEnd ? -last.index : last.index
      if (index === 0)
        return change === 'insert' ? document : splice(parent.start, parent.end, value)
      if (change === 'replace' || last.fromEnd) return document
      return splice(parent.start, parent.end, `[${nodeText(document, parent)}, ${value}]`)
    }
    const index = last.fromEnd ? parent.items.length - 1 - last.index : last.index
    const item = parent.items[index]
    if (item !== undefined) {
      if (change === 'insert') return document
      return splice(item.start, item.end, value)
    }
    if (change === 'replace' || index < 0) return document
    if (parent.items.length === 0) return splice(parent.start, parent.end, `[${value}]`)
    const end = parent.items.at(-1)!.end
    return splice(end, end, `, ${value}`)
  }
  return undefined
}

/** A document without the value at a path, as JSON_REMOVE has it, or undefined for paths it cannot remove. */
export function removeJson(document: string, path: JsonPath): string | undefined {
  if (path.wildcard || path.steps.length === 0) return undefined
  const root = parseJson(document)
  const [parent] = matchPath(root, { steps: path.steps.slice(0, -1), wildcard: false })
  if (parent === undefined) return document
  const last = path.steps.at(-1)!
  /** Cuts the entries at `index` of entries that start and end where given, with the comma before or after them. */
  const cut = (entries: readonly { start: number; end: number }[], index: number) => {
    const entry = entries[index]!
    if (entries.length === 1)
      return document.slice(0, entries[0]!.start) + document.slice(entry.end)
    if (index > 0) return document.slice(0, entries[index - 1]!.end) + document.slice(entry.end)
    return document.slice(0, entry.start) + document.slice(entries[1]!.start)
  }
  if (last.kind === 'member' && parent.kind === 'object') {
    const index = parent.members.findIndex((member) => member.key === last.key)
    if (index === -1) return document
    return cut(
      parent.members.map((member) => ({ start: member.keyStart, end: member.value.end })),
      index,
    )
  }
  if (last.kind === 'item' && parent.kind === 'array') {
    const index = last.fromEnd ? parent.items.length - 1 - last.index : last.index
    if (parent.items[index] === undefined) return document
    return cut(parent.items, index)
  }
  return document
}

/** The keys of an object, as JSON_KEYS gives them, or undefined for values that are no objects. */
export function jsonKeys(node: JsonNode): string | undefined {
  if (node.kind !== 'object') return undefined
  return `[${node.members.map((member) => quoteJson(member.key)).join(', ')}]`
}

/** Two documents merged as JSON_MERGE_PATCH merges them: members of the second replace the first's, and null removes them. */
export function mergePatch(aText: string, a: JsonNode, bText: string, b: JsonNode): string {
  if (b.kind !== 'object') return writeNode(bText, b)
  const base = a.kind === 'object' ? a.members : []
  const members: string[] = []
  for (const member of base) {
    const patch = b.members.find((candidate) => candidate.key === member.key)
    if (patch === undefined)
      members.push(`${quoteJson(member.key)}: ${writeNode(aText, member.value)}`)
    else if (patch.value.kind !== 'null')
      members.push(
        `${quoteJson(member.key)}: ${mergePatch(aText, member.value, bText, patch.value)}`,
      )
  }
  for (const patch of b.members) {
    if (base.some((member) => member.key === patch.key) || patch.value.kind === 'null') continue
    members.push(
      `${quoteJson(patch.key)}: ${mergePatch(bText, { kind: 'null', start: 0, end: 0 }, bText, patch.value)}`,
    )
  }
  return `{${members.join(', ')}}`
}

/** Two documents merged as JSON_MERGE_PRESERVE merges them: arrays join, objects merge, and scalars become arrays. */
export function mergePreserve(aText: string, a: JsonNode, bText: string, b: JsonNode): string {
  if (a.kind === 'object' && b.kind === 'object') {
    const members: string[] = []
    for (const member of a.members) {
      const other = b.members.find((candidate) => candidate.key === member.key)
      members.push(
        `${quoteJson(member.key)}: ${other === undefined ? writeNode(aText, member.value) : mergePreserve(aText, member.value, bText, other.value)}`,
      )
    }
    for (const member of b.members) {
      if (!a.members.some((existing) => existing.key === member.key))
        members.push(`${quoteJson(member.key)}: ${writeNode(bText, member.value)}`)
    }
    return `{${members.join(', ')}}`
  }
  const items = (text: string, node: JsonNode) =>
    node.kind === 'array'
      ? node.items.map((item) => writeNode(text, item))
      : [writeNode(text, node)]
  return `[${[...items(aText, a), ...items(bText, b)].join(', ')}]`
}

/** The paths of a document's strings that match a LIKE pattern, as JSON_SEARCH finds them. */
export function searchJson(node: JsonNode, matches: (text: string) => boolean): string[] {
  const found: string[] = []
  const visit = (value: JsonNode, path: string) => {
    if (value.kind === 'string' && matches(value.value)) found.push(path)
    if (value.kind === 'object') {
      for (const member of value.members) {
        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(member.key)
          ? member.key
          : quoteJson(member.key)
        visit(member.value, `${path}.${key}`)
      }
    }
    if (value.kind === 'array') value.items.forEach((item, i) => visit(item, `${path}[${i}]`))
  }
  visit(node, '$')
  return found
}

/** A document written as JSON_DETAILED writes it: indented by four spaces. */
export function detailedJson(document: string, node: JsonNode, indent = ''): string {
  const inner = `${indent}    `
  if (node.kind === 'object') {
    if (node.members.length === 0) return '{}'
    const lines = node.members.map(
      (member) =>
        `${inner}${quoteJson(member.key)}: ${detailedJson(document, member.value, inner)}`,
    )
    return `{\n${lines.join(',\n')}\n${indent}}`
  }
  if (node.kind === 'array') {
    if (node.items.length === 0) return '[]'
    return `[\n${node.items.map((item) => `${inner}${detailedJson(document, item, inner)}`).join(',\n')}\n${indent}]`
  }
  return writeNode(document, node)
}

/** A document without spaces between its tokens, as JSON_COMPACT writes it. */
export function compactJson(document: string, node: JsonNode): string {
  if (node.kind === 'object')
    return `{${node.members.map((member) => `${quoteJson(member.key)}:${compactJson(document, member.value)}`).join(',')}}`
  if (node.kind === 'array')
    return `[${node.items.map((item) => compactJson(document, item)).join(',')}]`
  return writeNode(document, node)
}

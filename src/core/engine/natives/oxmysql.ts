import { defineNative, NativeError, type NativeDefinition } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { jsOfMsgpack, msgpackOfJs, type JsValue } from '../javascript.ts'
import { packObject, unpackObject } from '../msgpack.ts'
import { isFalsy, type QueryType } from '../oxmysql.ts'

const QUERY_TYPES = new Set<string>(['single', 'scalar', 'insert', 'update'])

function text(value: JsValue): string {
  return typeof value === 'string' ? value : String(value)
}

/**
 * The native of FiveRunner's own script of oxmysql, which starts what its
 * exports do with what they got, and gives the token that the result
 * comes back with, whether it comes, and the result when it came at once.
 * No other script may call it.
 */
export function oxmysqlNatives(): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      { name: 'FIVERUNNER_OXMYSQL', result: 'object', params: ['char* method', 'bytes args'] },
      (ctx: NativeContext, method, args) => {
        const { manager, resource } = ctx
        const oxmysql = manager.oxmysql
        if (oxmysql === undefined || !resource.emulatesOxmysql) {
          throw new NativeError("only FiveRunner's oxmysql calls FIVERUNNER_OXMYSQL")
        }
        const values = args === null ? [] : jsOfMsgpack(unpackObject(args))
        const arg = (i: number): JsValue => (Array.isArray(values) ? values[i] : undefined)
        const callback = (given: JsValue, isPromise: JsValue) => ({
          given: given === true,
          isPromise: !isFalsy(isPromise),
        })
        const operation = (token: number): boolean => {
          switch (method) {
            case 'connect':
              return oxmysql.connect(token)
            case 'query': {
              const kind = arg(0)
              const type =
                typeof kind === 'string' && QUERY_TYPES.has(kind) ? (kind as QueryType) : null
              return oxmysql.query(
                token,
                type,
                text(arg(1)),
                arg(2),
                arg(3),
                callback(arg(4), arg(5)),
              )
            }
            case 'execute':
              return oxmysql.execute(
                token,
                text(arg(0)),
                arg(1),
                arg(2),
                callback(arg(3), arg(4)),
                arg(5) === true,
              )
            case 'transaction':
              return oxmysql.transaction(
                token,
                text(arg(0)),
                arg(1),
                arg(2),
                callback(arg(3), arg(4)),
              )
            case 'begin':
              return oxmysql.begin(token, text(arg(0)))
            case 'transactionQuery':
              return oxmysql.transactionQuery(
                token,
                Number(arg(0)),
                arg(1) === true,
                arg(2),
                arg(3),
              )
            case 'end': {
              const failure = arg(2)
              return oxmysql.end(
                token,
                Number(arg(0)),
                arg(1) === true,
                failure === null || failure === undefined ? undefined : text(failure),
              )
            }
            default:
              throw new NativeError(`FiveRunner's oxmysql has no operation ${String(method)}`)
          }
        }
        return packObject(msgpackOfJs(oxmysql.start(operation)))
      },
    ),
  ]
}

/*
 * FiveRunner's runtime of JavaScript resources, which runs in their QuickJS
 * contexts, before their scripts: the natives, which load as scripts first
 * name them, msgpack, function references, events, exports, timers, the
 * console and state bags, which behave as those of FiveM's JavaScript runtime
 * do, so that resources do not tell them apart.
 *
 * `host` has what the context gets of FiveRunner. The runtime gives it back
 * the functions that FiveRunner calls: tick, event and those of references.
 */
;(function (global, host) {
  'use strict'

  const EXT_VECTOR2 = 20
  const EXT_VECTOR3 = 21
  const EXT_VECTOR4 = 22
  const EXT_QUATERNION = 23
  const EXT_FUNCREF = 10
  const EXT_LOCALFUNCREF = 11
  const EXT_ENTITY = 41
  const EXT_PLAYER = 42

  const server = host.server

  /* Text. QuickJS has no TextEncoder or TextDecoder. */

  function encodeText(text) {
    const bytes = []
    for (const char of text) {
      const code = char.codePointAt(0)
      if (code < 0x80) bytes.push(code)
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
      else if (code < 0x10000) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
      } else {
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 63),
          0x80 | ((code >> 6) & 63),
          0x80 | (code & 63),
        )
      }
    }
    return new Uint8Array(bytes)
  }

  function decodeText(bytes, start = 0, end = bytes.length) {
    let text = ''
    let run = []
    for (let i = start; i < end;) {
      const byte = bytes[i++]
      let code = byte
      if (byte >= 0xf0) {
        code = ((byte & 7) << 18) | ((bytes[i] & 63) << 12)
        code |= ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)
        i += 3
      } else if (byte >= 0xe0) {
        code = ((byte & 15) << 12) | ((bytes[i] & 63) << 6) | (bytes[i + 1] & 63)
        i += 2
      } else if (byte >= 0xc0) code = ((byte & 31) << 6) | (bytes[i++] & 63)
      run.push(code)
      if (run.length >= 4096) {
        text += String.fromCodePoint(...run)
        run = []
      }
    }
    return text + String.fromCodePoint(...run)
  }

  global.TextEncoder = class TextEncoder {
    encoding = 'utf-8'
    encode(text = '') {
      return encodeText(String(text))
    }
  }

  global.TextDecoder = class TextDecoder {
    encoding = 'utf-8'
    decode(bytes) {
      if (bytes === undefined) return ''
      const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
      return decodeText(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    }
  }

  /* Dates, by the wall clock of FiveRunner, which tests may set. */

  const MachineDate = Date
  MachineDate.now = () => host.wallClock()
  global.Date = new Proxy(MachineDate, {
    construct: (date, args, target) =>
      Reflect.construct(date, args.length === 0 ? [host.wallClock()] : args, target),
    apply: () => new MachineDate(host.wallClock()).toString(),
  })
  MachineDate.prototype.constructor = global.Date

  /* What V8 has of errors, which libraries read as they load. */

  /** A frame of a stack, as V8 gives them to Error.prepareStackTrace. */
  function callSite(line) {
    const [, name = null, file = null, row = 0, column = 0] =
      /^\s*at (?:(.*?) )?\(?(.*?)(?::(\d+))?(?::(\d+))?\)?$/.exec(line) ?? []
    return {
      getFileName: () => file,
      getLineNumber: () => Number(row),
      getColumnNumber: () => Number(column),
      getFunctionName: () => name,
      getMethodName: () => name,
      getTypeName: () => null,
      getThis: () => undefined,
      getFunction: () => undefined,
      getEvalOrigin: () => undefined,
      isNative: () => false,
      isToplevel: () => true,
      isEval: () => false,
      isConstructor: () => false,
      toString: () => line.trim().replace(/^at /, ''),
    }
  }

  Error.stackTraceLimit = 10
  Error.captureStackTrace = (object) => {
    const { stack = '' } = new Error()
    const prepare = Error.prepareStackTrace
    object.stack =
      typeof prepare === 'function'
        ? prepare(object, stack.split('\n').filter(Boolean).map(callSite))
        : stack
  }

  /* The natives, which are globals that load as scripts first name them. */

  /** The function of a native, as the natives of FiveM's JavaScript take and give values. */
  function loadNative(name) {
    const found = host.native(name)
    if (found === null) return undefined
    const [id, kinds, unpacksResult] = found
    const convert = kinds.includes('f') || kinds.includes('o')
    return function (...args) {
      if (convert) {
        for (let i = 0; i < kinds.length; i++) {
          if (kinds[i] === 'f' && typeof args[i] === 'function') {
            args[i] = Citizen.makeRefFunction(args[i])
          } else if (kinds[i] === 'o') {
            args[i] = args[i] instanceof ArrayBuffer ? args[i] : pack(args[i]).buffer
          }
        }
      }
      const result = host.invoke(id, ...args)
      return unpacksResult ? unpack(result) : result
    }
  }

  const prototype = Object.getPrototypeOf(global)
  const isNativeName = (key) => typeof key === 'string' && /^[A-Z_]/.test(key)
  Object.setPrototypeOf(
    global,
    new Proxy(prototype, {
      has(target, key) {
        if (key in target) return true
        return isNativeName(key) && host.hasNative(key)
      },
      get(target, key, receiver) {
        if (key in target || !isNativeName(key)) return Reflect.get(target, key, receiver)
        const native = loadNative(key)
        if (native !== undefined) global[key] = native
        return native
      },
    }),
  )

  /* msgpack, as msgpack-lite packs for FiveM's JavaScript runtime. */

  function unpack(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    if (bytes.length === 0) return undefined
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let at = 0
    const array = (length) => {
      const items = new Array(length)
      for (let i = 0; i < length; i++) items[i] = read()
      return items
    }
    const map = (length) => {
      const object = {}
      for (let i = 0; i < length; i++) {
        const key = read()
        object[key] = read()
      }
      return object
    }
    const text = (length) => {
      const value = decodeText(bytes, at, at + length)
      at += length
      return value
    }
    const binary = (length) => {
      const value = bytes.slice(at, at + length)
      at += length
      return global.Buffer === undefined ? value.buffer : global.Buffer.from(value.buffer)
    }
    const ext = (length) => {
      const type = bytes[at++]
      const body = bytes.subarray(at, at + length)
      at += length
      return unpackExt(type, body)
    }
    const big = (value) =>
      value >= -9007199254740991n && value <= 9007199254740991n ? Number(value) : Number(value)
    function read() {
      const byte = bytes[at++]
      if (byte < 0x80) return byte
      if (byte < 0x90) return map(byte & 15)
      if (byte < 0xa0) return array(byte & 15)
      if (byte < 0xc0) return text(byte & 31)
      if (byte >= 0xe0) return byte - 256
      let value
      switch (byte) {
        case 0xc0:
          return null
        case 0xc2:
          return false
        case 0xc3:
          return true
        case 0xc4:
          return binary(bytes[at++])
        case 0xc5:
          value = view.getUint16(at)
          at += 2
          return binary(value)
        case 0xc6:
          value = view.getUint32(at)
          at += 4
          return binary(value)
        case 0xc7:
          return ext(bytes[at++])
        case 0xc8:
          value = view.getUint16(at)
          at += 2
          return ext(value)
        case 0xc9:
          value = view.getUint32(at)
          at += 4
          return ext(value)
        case 0xca:
          value = view.getFloat32(at)
          at += 4
          return value
        case 0xcb:
          value = view.getFloat64(at)
          at += 8
          return value
        case 0xcc:
          return bytes[at++]
        case 0xcd:
          value = view.getUint16(at)
          at += 2
          return value
        case 0xce:
          value = view.getUint32(at)
          at += 4
          return value
        case 0xcf:
          value = big(view.getBigUint64(at))
          at += 8
          return value
        case 0xd0:
          value = view.getInt8(at)
          at += 1
          return value
        case 0xd1:
          value = view.getInt16(at)
          at += 2
          return value
        case 0xd2:
          value = view.getInt32(at)
          at += 4
          return value
        case 0xd3:
          value = big(view.getBigInt64(at))
          at += 8
          return value
        case 0xd4:
          return ext(1)
        case 0xd5:
          return ext(2)
        case 0xd6:
          return ext(4)
        case 0xd7:
          return ext(8)
        case 0xd8:
          return ext(16)
        case 0xd9:
          return text(bytes[at++])
        case 0xda:
          value = view.getUint16(at)
          at += 2
          return text(value)
        case 0xdb:
          value = view.getUint32(at)
          at += 4
          return text(value)
        case 0xdc:
          value = view.getUint16(at)
          at += 2
          return array(value)
        case 0xdd:
          value = view.getUint32(at)
          at += 4
          return array(value)
        case 0xde:
          value = view.getUint16(at)
          at += 2
          return map(value)
        case 0xdf:
          value = view.getUint32(at)
          at += 4
          return map(value)
        default:
          throw new Error(`Invalid msgpack type: 0x${byte.toString(16)}`)
      }
    }
    return read()
  }

  /** The value of an extension, of those that FiveM's runtimes pack. */
  function unpackExt(type, body) {
    switch (type) {
      case EXT_FUNCREF:
      case EXT_LOCALFUNCREF:
        return proxyOfRef(decodeText(body))
      case EXT_VECTOR2:
      case EXT_VECTOR3:
      case EXT_VECTOR4:
      case EXT_QUATERNION: {
        const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
        const vector = []
        for (let i = 0; i + 4 <= body.length; i += 4) vector.push(view.getFloat32(i, true))
        return vector
      }
      case EXT_ENTITY:
        return global.Entity(NetworkGetEntityFromNetworkId(Number(decodeText(body))))
      case EXT_PLAYER:
        return global.Player(Number(decodeText(body)))
      default:
        return {}
    }
  }

  class Writer {
    bytes = new Uint8Array(256)
    view = new DataView(this.bytes.buffer)
    at = 0

    reserve(size) {
      if (this.at + size <= this.bytes.length) return
      let length = this.bytes.length * 2
      while (length < this.at + size) length *= 2
      const bytes = new Uint8Array(length)
      bytes.set(this.bytes.subarray(0, this.at))
      this.bytes = bytes
      this.view = new DataView(bytes.buffer)
    }

    byte(value) {
      this.reserve(1)
      this.bytes[this.at++] = value
    }

    raw(bytes) {
      this.reserve(bytes.length)
      this.bytes.set(bytes, this.at)
      this.at += bytes.length
    }

    /** A header with a size, of the smallest of the forms that are given. */
    sized(size, small, medium, large) {
      if (size < 0x100 && small !== undefined) {
        this.byte(small)
        this.byte(size)
      } else if (size < 0x10000) {
        this.reserve(3)
        this.byte(medium)
        this.view.setUint16(this.at, size)
        this.at += 2
      } else {
        this.reserve(5)
        this.byte(large)
        this.view.setUint32(this.at, size)
        this.at += 4
      }
    }

    number(value) {
      if ((value | 0) !== value) {
        this.reserve(9)
        this.byte(0xcb)
        this.view.setFloat64(this.at, value)
        this.at += 8
      } else if (value >= 0 && value < 0x80) this.byte(value)
      else if (value < 0 && value >= -32) this.byte(value + 256)
      else {
        this.reserve(5)
        this.byte(0xd2)
        this.view.setInt32(this.at, value)
        this.at += 4
      }
    }

    text(value) {
      const bytes = encodeText(value)
      if (bytes.length < 32) this.byte(0xa0 | bytes.length)
      else this.sized(bytes.length, 0xd9, 0xda, 0xdb)
      this.raw(bytes)
    }

    ext(type, body) {
      this.sized(body.length, 0xc7, 0xc8, 0xc9)
      this.byte(type)
      this.raw(body)
    }

    value(value) {
      if (value === null || value === undefined) return this.byte(0xc0)
      switch (typeof value) {
        case 'boolean':
          return this.byte(value ? 0xc3 : 0xc2)
        case 'number':
          return this.number(value)
        case 'bigint':
          return this.number(Number(value))
        case 'string':
          return this.text(value)
        case 'function':
          return this.ext(EXT_FUNCREF, encodeText(Citizen.makeRefFunction(value)))
        default:
          break
      }
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes =
          value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        this.sized(bytes.length, 0xc4, 0xc5, 0xc6)
        return this.raw(bytes)
      }
      if (Array.isArray(value)) {
        if (value.length < 16) this.byte(0x90 | value.length)
        else this.sized(value.length, undefined, 0xdc, 0xdd)
        for (let i = 0; i < value.length; i++) this.value(value[i])
        return undefined
      }
      if (typeof value.__pack === 'function')
        return this.ext(value.__ext, encodeText(value.__pack()))
      const keys = Object.keys(value)
      if (keys.length < 16) this.byte(0x80 | keys.length)
      else this.sized(keys.length, undefined, 0xde, 0xdf)
      for (const key of keys) {
        this.text(key)
        this.value(value[key])
      }
      return undefined
    }
  }

  function pack(value) {
    const writer = new Writer()
    writer.value(value)
    return writer.bytes.slice(0, writer.at)
  }

  global.msgpack_pack = pack
  global.msgpack_unpack = unpack

  /* The Citizen object. */

  const Citizen = {
    trace: host.trace,
    getTickCount: host.clock,
    getTimeZone: () => 'UTC',
    makeRefFunction,
    getRefFunction: (fn) => (typeof fn === 'function' ? makeRefFunction(fn) : null),
    canonicalizeRef: host.canonicalizeRef,
    invokeFunctionReference: host.invokeFunctionReference,
    makeFunctionReference: (ref) => (args) => host.invokeFunctionReference(ref, args.buffer),
  }
  global.Citizen = Citizen

  /* The functions that other runtimes hold references to. */

  const references = new Map()
  let nextReference = 0

  function makeRefFunction(fn) {
    const index = nextReference++
    references.set(index, { fn, holders: 0 })
    return host.canonicalizeRef(index)
  }

  /** A function that calls the function of a reference of another runtime. */
  function proxyOfRef(ref) {
    const invoker = GetInvokingResource()
    return function (...args) {
      let results = null
      try {
        const packed = host.invokeFunctionReference(ref, pack(args).buffer)
        results = packed === null ? null : unpack(packed)
      } catch {}
      if (results === null || results === undefined) {
        const resource = GetCurrentResourceName()
        let message = `Error in nested ref call for ${resource}. `
        if (invoker) {
          message += `${resource} tried to call a function reference in ${invoker} but the reference wasn't valid. `
          message +=
            GetResourceState(invoker) !== 'started'
              ? `And ${invoker} isn't started, was the resource restarted mid call?`
              : `(did ${invoker} restart recently?)`
        }
        throw new Error(message)
      }
      if (results.length === 0) return undefined
      if (results.length > 1) return results
      const [result] = results
      if (result && result.__cfx_async_retval) {
        return new Promise((resolve, reject) => {
          result.__cfx_async_retval((values, error) => {
            if (error !== null && error !== undefined) reject(error)
            else resolve(values.length === 1 ? values[0] : values.length === 0 ? undefined : values)
          })
        })
      }
      return result
    }
  }

  host.callRef = (index, args) => {
    const reference = references.get(index)
    if (reference === undefined) {
      console.error('Invalid ref call attempt:', index)
      return pack([]).buffer
    }
    try {
      const result = reference.fn(...unpack(args))
      if (result instanceof Promise) {
        const later = (callback) => {
          result.then(
            (value) => callback?.([value], null),
            (error) =>
              callback?.(null, error?.message ? String(error.message) : String(error ?? '')),
          )
        }
        return pack([{ __cfx_async_retval: later }]).buffer
      }
      return pack([result]).buffer
    } catch (error) {
      printError('call ref', error)
      return pack(null).buffer
    }
  }

  host.duplicateRef = (index) => {
    const reference = references.get(index)
    if (reference === undefined) return -1
    reference.holders++
    return index
  }

  host.deleteRef = (index) => {
    const reference = references.get(index)
    if (reference !== undefined && --reference.holders <= 0) references.delete(index)
  }

  /* The console. */

  function formatValue(value) {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (value instanceof Error) return value.stack ? `${value}\n${value.stack}` : String(value)
    if (value instanceof Map) return `Map(${value.size}) ${formatValue([...value])}`
    if (value instanceof Set) return `Set(${value.size}) ${formatValue([...value])}`
    if (ArrayBuffer.isView(value)) return `${value.constructor.name}[ ${[...value].join(' ')} ]`
    if (typeof value === 'object') {
      const seen = new Set()
      return JSON.stringify(
        value,
        (_key, item) => {
          if (typeof item === 'object' && item !== null) {
            if (seen.has(item)) return undefined
            seen.add(item)
          }
          return item
        },
        2,
      )
    }
    return String(value)
  }

  /** What console.log writes, by the specifiers of its first argument, if it is a string. */
  function format(first, ...rest) {
    if (typeof first !== 'string') return [first, ...rest].map(formatValue).join(' ')
    let used = 0
    const text = first.replace(/%([sdifoOc%])/g, (whole, specifier) => {
      if (specifier === '%') return '%'
      if (used >= rest.length) return whole
      const value = rest[used++]
      switch (specifier) {
        case 'd':
        case 'i':
          return String(Math.trunc(Number(value)))
        case 'f':
          return String(Number(value))
        case 'c':
          return ''
        case 's':
          return typeof value === 'string' ? value : formatValue(value)
        default:
          return formatValue(value)
      }
    })
    return [text, ...rest.slice(used).map(formatValue)].join(' ')
  }

  const timers = new Map()
  const counters = new Map()
  const write = (text) => host.trace(`${text}\n`)
  const console = {
    log: (...args) => write(format(...args)),
    debug: (...args) => write(`Debug: ${format(...args)}`),
    info: (...args) => write(`Info: ${format(...args)}`),
    warn: (...args) => write(`^3Warning: ${format(...args)}^7`),
    error: (...args) => write(`^1Error: ${format(...args)}^7`),
    trace: (...args) => write(`Trace: ${format(...args)}\n${new Error().stack ?? ''}`),
    assert(condition, ...args) {
      if (!condition) console.error('Assertion failed:', ...args)
    },
    time: (label = 'default') => timers.set(label, host.clock()),
    timeEnd(label = 'default') {
      if (timers.has(label)) write(`${label}: ${host.clock() - timers.get(label)}ms`)
      timers.delete(label)
    },
    count(label = 'default') {
      counters.set(label, (counters.get(label) ?? 0) + 1)
      write(`${label}: ${counters.get(label)}`)
    },
    dir: (value) => write(formatValue(value)),
    group() {},
    groupCollapsed() {},
    groupEnd() {},
    table: (value) => write(formatValue(value)),
  }
  global.console = console

  function printError(where, error) {
    const stack = error?.stack ? `\n${error.stack}` : ''
    write(`^1SCRIPT ERROR in ${where}: ${error}^7${stack}`)
  }
  global.printError = printError

  /* Events. */

  const listeners = new Map()
  const rawListeners = new Map()
  const netSafe = new Set()

  const listenerOf = (table, name) => {
    let list = table.get(name)
    if (list === undefined) table.set(name, (list = []))
    return list
  }

  global.addEventListener = (name, callback, safe = false) => {
    if (safe) netSafe.add(name)
    RegisterResourceAsEventHandler(name)
    listenerOf(listeners, name).push(callback)
  }
  global.on = global.addEventListener
  global.AddEventHandler = global.addEventListener
  global.addNetEventListener = (name, callback) => global.addEventListener(name, callback, true)
  global.onNet = global.addNetEventListener
  global.addRawEventListener = (name, callback) => {
    RegisterResourceAsEventHandler(name)
    listenerOf(rawListeners, name).push(callback)
  }
  global.addRawEventHandler = global.addRawEventListener
  global.removeEventListener = (name, callback) => {
    const list = listeners.get(name)
    const index = list?.indexOf(callback) ?? -1
    if (index >= 0) list.splice(index, 1)
  }
  global.RemoveEventHandler = global.removeEventListener
  global.RegisterNetEvent = (name) => void netSafe.add(name)
  global.RegisterServerEvent = global.RegisterNetEvent
  global.setMaxEventListeners = () => {}
  global.setMaxRawEventListeners = () => {}

  global.emit = (name, ...args) => {
    const payload = pack(args)
    TriggerEventInternal(name, payload.buffer, payload.length)
  }
  global.TriggerEvent = global.emit

  if (server) {
    global.emitNet = (name, source, ...args) => {
      const payload = pack(args)
      TriggerClientEventInternal(name, source, payload.buffer, payload.length)
    }
    global.TriggerClientEvent = global.emitNet
    global.TriggerLatentClientEvent = (name, source, bps, ...args) => {
      const payload = pack(args)
      TriggerLatentClientEventInternal(name, source, payload.buffer, payload.length, bps)
    }
    const listOf = (count, item) => Array.from({ length: count }, (_, i) => item(i))
    global.getPlayerIdentifiers = (player) =>
      listOf(GetNumPlayerIdentifiers(player), (i) => GetPlayerIdentifier(player, i))
    global.getPlayerTokens = (player) =>
      listOf(GetNumPlayerTokens(player), (i) => GetPlayerToken(player, i))
    global.getPlayers = () => listOf(GetNumPlayerIndices(), (i) => GetPlayerFromIndex(i))
  } else {
    global.SendNUIMessage = (data) => SendNuiMessage(JSON.stringify(data))
    global.emitNet = (name, ...args) => {
      const payload = pack(args)
      TriggerServerEventInternal(name, payload.buffer, payload.length)
    }
    global.TriggerServerEvent = global.emitNet
    global.TriggerLatentServerEvent = (name, bps, ...args) => {
      const payload = pack(args)
      TriggerLatentServerEventInternal(name, payload.buffer, payload.length, bps)
    }
  }

  host.event = (name, payload, source) => {
    global.source = source
    if (source.startsWith('net')) {
      if ((listeners.get(name)?.length ?? 0) > 0 && !netSafe.has(name)) {
        console.error(`Event ${name} was not safe for net`)
        global.source = null
        return
      }
      global.source = parseInt(source.slice(4))
    } else if (server && source.startsWith('internal-net')) {
      global.source = parseInt(source.slice(13))
    }
    for (const listener of [...(rawListeners.get(name) ?? [])]) {
      try {
        listener(payload, source)
      } catch (error) {
        console.error('Unhandled error during running raw event listeners', error)
      }
    }
    const list = listeners.get(name)
    if (list === undefined || list.length === 0) {
      global.source = null
      return
    }
    const args = unpack(payload) ?? []
    if (!Array.isArray(args)) {
      global.source = null
      return
    }
    for (const listener of [...list]) {
      try {
        const result = listener.apply(null, args)
        if (result instanceof Promise) {
          result.catch((error) => console.error('Unhandled promise failure:', error))
        }
      } catch (error) {
        printError(`event \`${name}'`, error)
      }
    }
    global.source = null
  }

  /* Exports. */

  const exportedBy = {}
  const exportKey = server ? 'server_export' : 'export'
  const exportEvent = (resource, name) =>
    `__cfx_export_${resource === 'txAdmin' ? 'monitor' : resource}_${name}`

  global.addEventListener(`on${server ? 'Server' : 'Client'}ResourceStart`, (resource) => {
    if (resource !== GetCurrentResourceName()) return
    const count = GetNumResourceMetadata(resource, exportKey) || 0
    for (let i = 0; i < count; i++) {
      const name = GetResourceMetadata(resource, exportKey, i)
      global.addEventListener(exportEvent(resource, name), (give) => {
        if (global[name]) give(global[name])
      })
    }
  })
  global.addEventListener(`on${server ? 'Server' : 'Client'}ResourceStop`, (resource) => {
    exportedBy[resource] = {}
  })

  global.exports = new Proxy(() => {}, {
    get(_target, resource) {
      return new Proxy(
        {},
        {
          get(_exports, name) {
            const known = (exportedBy[resource] ??= {})
            if (!known[name]) {
              global.emit(exportEvent(resource, name), (fn) => {
                known[name] = fn
              })
              if (!known[name]) throw new Error(`No such export ${name} in resource ${resource}`)
            }
            return (...args) => {
              try {
                return known[name](...args)
              } catch {
                throw new Error(
                  `An error occurred while calling export ${name} of resource ${resource} - see above for details`,
                )
              }
            }
          },
          set() {
            throw new Error('cannot set values on an export resource')
          },
        },
      )
    },
    apply(_target, _this, args) {
      if (args.length !== 2) throw new Error('this needs 2 arguments')
      const [name, fn] = args
      global.addEventListener(exportEvent(GetCurrentResourceName(), name), (give) => give(fn))
    },
    set() {
      throw new Error('cannot set values on exports')
    },
  })

  /* State bags. */

  global.NewStateBag = (name) =>
    new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'set') {
            return (bagKey, value, replicated) => {
              const payload = pack(value)
              SetStateBagValue(name, bagKey, payload.buffer, payload.length, replicated)
            }
          }
          return GetStateBagValue(name, key)
        },
        set(_target, key, value) {
          const payload = pack(value)
          SetStateBagValue(name, key, payload.buffer, payload.length, server)
          return true
        },
      },
    )

  global.GlobalState = global.NewStateBag('global')

  const entityBag = (entity) => {
    if (server || NetworkGetEntityIsNetworked(entity)) {
      return `entity:${NetworkGetNetworkIdFromEntity(entity)}`
    }
    EnsureEntityStateBag(entity)
    return `localEntity:${entity}`
  }

  /** The object of an entity or a player, whose state is its state bag, which msgpack packs by its id. */
  const handleOf = (ext, id, bag) =>
    new Proxy(
      {},
      {
        get(_target, key) {
          if (key === '__ext') return ext
          if (key === '__pack') return () => String(id())
          return key === 'state' ? global.NewStateBag(bag()) : null
        },
        set() {
          throw new Error('Not allowed at this time.')
        },
      },
    )

  global.Entity = (entity) => {
    if (typeof entity !== 'number') return entity
    return handleOf(
      EXT_ENTITY,
      () => NetworkGetNetworkIdFromEntity(entity),
      () => {
        const bag = entityBag(entity)
        if (server) EnsureEntityStateBag(entity)
        return bag
      },
    )
  }

  global.Player = (player) => {
    if (typeof player !== 'number' && typeof player !== 'string') return player
    const id = Number(player)
    const serverId = () => (id === -1 ? GetPlayerServerId(PlayerId()) : id)
    return handleOf(
      EXT_PLAYER,
      () => id,
      () => `player:${serverId()}`,
    )
  }

  if (!server) global.LocalPlayer = global.Player(-1)

  /* NUI. */

  if (!server) {
    global.RegisterNuiCallback = (type, callback) => {
      RegisterNuiCallbackType(type)
      global.addEventListener(`__cfx_nui:${type}`, callback)
    }
    global.RegisterNUICallback = global.RegisterNuiCallback
  }

  /* Timers, by the clock of FiveRunner. */

  const pending = new Map()
  const tickers = new Map()
  let frames = []
  let nextTimer = 1
  let nextTicker = 1

  const delayOf = (delay) => Math.max(1, Math.min(2147483647, delay || 1)) | 0

  class Timeout {
    constructor(id) {
      this.id = id
    }
    ref() {
      return this
    }
    unref() {
      return this
    }
    hasRef() {
      return true
    }
    refresh() {
      const timer = pending.get(this.id)
      if (timer !== undefined) timer.last = host.clock()
      return this
    }
    [Symbol.toPrimitive]() {
      return this.id
    }
  }

  function schedule(callback, delay, args, once) {
    if (typeof callback !== 'function') {
      throw new TypeError(`Callback must be a function. Received ${callback}`)
    }
    const id = nextTimer++
    pending.set(id, { callback, args, interval: delayOf(delay), last: host.clock(), once })
    return new Timeout(id)
  }

  function clearTimer(timer) {
    if (timer) pending.delete(typeof timer === 'object' ? timer.id : timer)
  }

  Object.assign(global, {
    setTimeout: (callback, delay, ...args) => schedule(callback, delay, args, true),
    setInterval: (callback, delay, ...args) => schedule(callback, delay, args, false),
    setImmediate: (callback, ...args) => schedule(callback, 0, args, true),
    clearTimeout: clearTimer,
    clearInterval: clearTimer,
    clearImmediate: clearTimer,
    queueMicrotask(callback) {
      Promise.resolve()
        .then(callback)
        .catch((error) => printError('microtask', error))
    },
    requestAnimationFrame: (callback) => void frames.push(callback),
    setTick(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError(`Callback must be a function. Received ${callback}`)
      }
      const id = nextTicker++
      tickers.set(id, { callback, waiting: false })
      return id
    },
    clearTick: (id) => void tickers.delete(id),
  })

  host.tick = (now) => {
    for (const [id, timer] of [...pending]) {
      if (now - timer.last < timer.interval || !pending.has(id)) continue
      timer.last = now
      if (timer.once) pending.delete(id)
      try {
        timer.callback(...timer.args)
      } catch (error) {
        printError('timer', error)
      }
    }
    for (const [id, ticker] of [...tickers]) {
      if (ticker.waiting || !tickers.has(id)) continue
      let result
      try {
        result = ticker.callback()
      } catch (error) {
        printError('ticker', error)
        continue
      }
      if (typeof result?.then === 'function') {
        ticker.waiting = true
        result
          .catch((error) => printError('ticker', error))
          .then(() => {
            ticker.waiting = false
          })
      }
    }
    const current = frames
    frames = []
    for (const frame of current) {
      try {
        frame()
      } catch (error) {
        printError('animationFrame', error)
      }
    }
    global.process?._tickCallback?.()
  }

  global.global = global
})(globalThis, globalThis.__fiverunner)

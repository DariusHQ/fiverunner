/*
 * What the JavaScript of FiveM's servers gets of Node, on QuickJS: process,
 * Buffer, URL and the modules that resources require. Those that reach the
 * machine, such as net and http, are there for what bundles do as they load,
 * and do nothing, which keeps resources to the files of FiveRunner.
 */
;(function (global, host) {
  'use strict'

  /* Buffer. */

  const HEX = '0123456789abcdef'
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  function encodeBase64(bytes, url) {
    const alphabet = url ? `${BASE64.slice(0, 62)}-_` : BASE64
    let text = ''
    for (let i = 0; i < bytes.length; i += 3) {
      const word = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
      text += alphabet[word >> 18] + alphabet[(word >> 12) & 63]
      text += i + 1 < bytes.length ? alphabet[(word >> 6) & 63] : url ? '' : '='
      text += i + 2 < bytes.length ? alphabet[word & 63] : url ? '' : '='
    }
    return text
  }

  function decodeBase64(text) {
    const clean = text
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/[^A-Za-z0-9+/]/g, '')
    const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
    let at = 0
    for (let i = 0; i < clean.length; i += 4) {
      const word =
        (BASE64.indexOf(clean[i]) << 18) |
        (BASE64.indexOf(clean[i + 1]) << 12) |
        ((BASE64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) |
        (BASE64.indexOf(clean[i + 3] ?? 'A') & 63)
      for (const byte of [word >> 16, (word >> 8) & 255, word & 255]) {
        if (at < bytes.length) bytes[at++] = byte
      }
    }
    return bytes
  }

  function bytesOf(text, encoding = 'utf8') {
    switch (String(encoding).toLowerCase()) {
      case 'hex': {
        const bytes = new Uint8Array(text.length >> 1)
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16)
        return bytes
      }
      case 'base64':
      case 'base64url':
        return decodeBase64(text)
      case 'ascii':
      case 'latin1':
      case 'binary':
        return Uint8Array.from(text, (char) => char.charCodeAt(0) & 255)
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le': {
        const bytes = new Uint8Array(text.length * 2)
        for (let i = 0; i < text.length; i++) {
          bytes[i * 2] = text.charCodeAt(i) & 255
          bytes[i * 2 + 1] = text.charCodeAt(i) >> 8
        }
        return bytes
      }
      default:
        return new TextEncoder().encode(text)
    }
  }

  /** The chars of bytes, one for each, in runs that the arguments of a call can hold. */
  function charsOf(bytes, mask) {
    let text = ''
    for (let i = 0; i < bytes.length; i += 4096) {
      text += String.fromCharCode(...bytes.subarray(i, i + 4096).map((byte) => byte & mask))
    }
    return text
  }

  class Buffer extends Uint8Array {
    static from(value, encodingOrOffset, length) {
      if (typeof value === 'string') return Buffer.#of(bytesOf(value, encodingOrOffset))
      if (value instanceof ArrayBuffer) {
        return new Buffer(value, encodingOrOffset, length)
      }
      if (ArrayBuffer.isView(value)) {
        return Buffer.#of(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice())
      }
      if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data)
      return Buffer.#of(Uint8Array.from(value))
    }

    static #of(bytes) {
      return new Buffer(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    }

    static alloc(size, fill) {
      const buffer = new Buffer(size)
      return fill === undefined ? buffer : buffer.fill(fill)
    }

    static allocUnsafe(size) {
      return new Buffer(size)
    }

    static allocUnsafeSlow(size) {
      return new Buffer(size)
    }

    static isBuffer(value) {
      return value instanceof Buffer
    }

    static isEncoding(encoding) {
      return /^(utf-?8|hex|base64(url)?|ascii|latin1|binary|ucs-?2|utf-?16le)$/i.test(encoding)
    }

    static byteLength(value, encoding) {
      return typeof value === 'string' ? bytesOf(value, encoding).length : value.byteLength
    }

    static concat(list, total) {
      const length = total ?? list.reduce((sum, item) => sum + item.length, 0)
      const buffer = new Buffer(length)
      let at = 0
      for (const item of list) {
        if (at >= length) break
        buffer.set(item.subarray(0, length - at), at)
        at += item.length
      }
      return buffer
    }

    static compare(a, b) {
      return a.compare(b)
    }

    toString(encoding = 'utf8', start = 0, end = this.length) {
      const bytes = this.subarray(start, end)
      switch (String(encoding).toLowerCase()) {
        case 'hex':
          return Array.from(bytes, (byte) => HEX[byte >> 4] + HEX[byte & 15]).join('')
        case 'base64':
          return encodeBase64(bytes, false)
        case 'base64url':
          return encodeBase64(bytes, true)
        case 'ascii':
          return charsOf(bytes, 0x7f)
        case 'latin1':
        case 'binary':
          return charsOf(bytes, 0xff)
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le': {
          let text = ''
          for (let i = 0; i + 1 < bytes.length; i += 2) {
            text += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8))
          }
          return text
        }
        default:
          return new TextDecoder().decode(bytes)
      }
    }

    toJSON() {
      return { type: 'Buffer', data: Array.from(this) }
    }

    equals(other) {
      return this.compare(other) === 0
    }

    compare(other) {
      const length = Math.min(this.length, other.length)
      for (let i = 0; i < length; i++) {
        if (this[i] !== other[i]) return this[i] < other[i] ? -1 : 1
      }
      return Math.sign(this.length - other.length)
    }

    fill(value, start = 0, end = this.length, encoding) {
      if (typeof value !== 'string') return super.fill(value, start, end)
      const pattern = bytesOf(value, encoding)
      for (let i = start; i < end; i++) this[i] = pattern[(i - start) % pattern.length] ?? 0
      return this
    }

    indexOf(value, from = 0, encoding) {
      if (typeof value === 'number') return super.indexOf(value & 255, from)
      const pattern = typeof value === 'string' ? bytesOf(value, encoding) : value
      for (let i = from; i <= this.length - pattern.length; i++) {
        if (pattern.every((byte, at) => this[i + at] === byte)) return i
      }
      return -1
    }

    includes(value, from, encoding) {
      return this.indexOf(value, from, encoding) !== -1
    }

    slice(start, end) {
      return this.subarray(start, end)
    }

    subarray(start, end) {
      const view = super.subarray(start, end)
      return new Buffer(view.buffer, view.byteOffset, view.byteLength)
    }

    write(text, offset = 0, length, encoding) {
      const bytes = bytesOf(text, typeof length === 'string' ? length : encoding)
      const count = Math.min(bytes.length, this.length - offset)
      this.set(bytes.subarray(0, count), offset)
      return count
    }

    copy(target, at = 0, start = 0, end = this.length) {
      const bytes = super.subarray(start, end)
      const count = Math.max(0, Math.min(bytes.length, target.length - at))
      if (count > 0) target.set(bytes.subarray(0, count), at)
      return count
    }

    get #view() {
      return new DataView(this.buffer, this.byteOffset, this.byteLength)
    }

    static {
      const numbers = [
        ['UInt8', 'getUint8', 'setUint8', 1],
        ['Int8', 'getInt8', 'setInt8', 1],
        ['UInt16', 'getUint16', 'setUint16', 2],
        ['Int16', 'getInt16', 'setInt16', 2],
        ['UInt32', 'getUint32', 'setUint32', 4],
        ['Int32', 'getInt32', 'setInt32', 4],
        ['Float', 'getFloat32', 'setFloat32', 4],
        ['Double', 'getFloat64', 'setFloat64', 8],
        ['BigInt64', 'getBigInt64', 'setBigInt64', 8],
        ['BigUInt64', 'getBigUint64', 'setBigUint64', 8],
      ]
      for (const [name, getter, setter, size] of numbers) {
        for (const [suffix, little] of size === 1
          ? [['', true]]
          : [
              ['LE', true],
              ['BE', false],
            ]) {
          for (const alias of [name, name.replace('UInt', 'Uint')]) {
            Buffer.prototype[`read${alias}${suffix}`] = function (offset = 0) {
              return this.#view[getter](offset, little)
            }
            Buffer.prototype[`write${alias}${suffix}`] = function (value, offset = 0) {
              this.#view[setter](offset, value, little)
              return offset + size
            }
          }
        }
      }
    }
  }

  for (const encoding of ['ascii', 'latin1', 'utf8', 'hex', 'ucs2', 'base64']) {
    Buffer.prototype[`${encoding}Slice`] = function (start, end) {
      return this.toString(encoding, start, end)
    }
  }
  // Node's functions of Buffer are enumerable: safer-buffer and mysql2 go through them.
  for (const object of [Buffer, Buffer.prototype]) {
    for (const name of Object.getOwnPropertyNames(object)) {
      const { value } = Object.getOwnPropertyDescriptor(object, name)
      if (name !== 'constructor' && typeof value === 'function') {
        Object.defineProperty(object, name, { enumerable: true })
      }
    }
  }

  // Old code calls Buffer without new, as safe-buffer does.
  global.Buffer = new Proxy(Buffer, {
    apply: (_target, _this, [value, encoding, length]) =>
      typeof value === 'number' ? Buffer.alloc(value) : Buffer.from(value, encoding, length),
  })
  global.atob = (text) => Buffer.from(text, 'base64').toString('latin1')
  global.btoa = (text) => Buffer.from(text, 'latin1').toString('base64')

  /* Events. Old code calls these constructors with .call(this), so they are no classes. */

  function EventEmitter() {
    this._listeners ??= new Map()
    this._maxListeners ??= 10
  }

  const listenersOf = (emitter) => (emitter._listeners ??= new Map())

  Object.assign(EventEmitter.prototype, {
    on(name, listener) {
      const listeners = listenersOf(this)
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(listener)
      return this
    },
    addListener(name, listener) {
      return this.on(name, listener)
    },
    prependListener(name, listener) {
      const listeners = listenersOf(this)
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).unshift(listener)
      return this
    },
    once(name, listener) {
      const once = (...args) => {
        this.off(name, once)
        listener.apply(this, args)
      }
      once.listener = listener
      return this.on(name, once)
    },
    off(name, listener) {
      const list = listenersOf(this).get(name)
      const index = list?.findIndex((item) => item === listener || item.listener === listener) ?? -1
      if (index >= 0) list.splice(index, 1)
      return this
    },
    removeListener(name, listener) {
      return this.off(name, listener)
    },
    removeAllListeners(name) {
      if (name === undefined) listenersOf(this).clear()
      else listenersOf(this).delete(name)
      return this
    },
    emit(name, ...args) {
      const list = listenersOf(this).get(name)
      if (list === undefined || list.length === 0) {
        if (name === 'error') throw args[0] instanceof Error ? args[0] : new Error(String(args[0]))
        return false
      }
      for (const listener of [...list]) listener.apply(this, args)
      return true
    },
    listeners(name) {
      return (listenersOf(this).get(name) ?? []).map((item) => item.listener ?? item)
    },
    rawListeners(name) {
      return [...(listenersOf(this).get(name) ?? [])]
    },
    listenerCount(name) {
      return listenersOf(this).get(name)?.length ?? 0
    },
    eventNames() {
      return [...listenersOf(this).keys()]
    },
    setMaxListeners(max) {
      this._maxListeners = max
      return this
    },
    getMaxListeners() {
      return this._maxListeners ?? 10
    },
  })
  EventEmitter.EventEmitter = EventEmitter
  EventEmitter.defaultMaxListeners = 10
  EventEmitter.once = (emitter, name) =>
    new Promise((resolve) => emitter.once(name, (...args) => resolve(args)))

  const inherit = (child, parent, members = {}) => {
    child.super_ = parent
    Object.setPrototypeOf(child.prototype, parent.prototype)
    Object.setPrototypeOf(child, parent)
    Object.assign(child.prototype, members)
    return child
  }

  /* process. */

  const startedAt = host.clock()
  const processEvents = new EventEmitter()
  const stream = (write) => Object.assign(new EventEmitter(), { write, isTTY: false, fd: 1 })
  const write = (text) => {
    host.trace(String(text))
    return true
  }
  global.process = Object.assign(processEvents, {
    env: {},
    argv: ['node', 'fxserver'],
    execArgv: [],
    execPath: 'node',
    title: 'FXServer',
    platform: 'win32',
    arch: 'x64',
    release: { name: 'node' },
    version: 'v22.0.0',
    versions: { node: '22.0.0', v8: '12.0.0' },
    pid: 1,
    ppid: 0,
    browser: false,
    exitCode: undefined,
    cwd: () => '/',
    chdir() {},
    umask: () => 0,
    uptime: () => (host.clock() - startedAt) / 1000,
    hrtime: Object.assign(
      (since) => {
        const now = host.clock()
        const time = [Math.floor(now / 1000), Math.round((now % 1000) * 1e6)]
        if (since === undefined) return time
        const nanos = time[1] - since[1]
        return nanos < 0 ? [time[0] - since[0] - 1, nanos + 1e9] : [time[0] - since[0], nanos]
      },
      { bigint: () => BigInt(Math.round(host.clock() * 1e6)) },
    ),
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
    cpuUsage: () => ({ user: 0, system: 0 }),
    nextTick: (callback, ...args) => void Promise.resolve().then(() => callback(...args)),
    emitWarning: (warning) => console.warn(warning),
    exit() {},
    abort() {},
    getuid: () => 0,
    getgid: () => 0,
    binding() {
      throw new Error('process.binding is not supported')
    },
    stdout: stream(write),
    stderr: stream(write),
    stdin: stream(() => true),
  })

  /* URL. */

  class URLSearchParams {
    #entries = []

    constructor(init = '') {
      if (typeof init === 'string') {
        for (const part of init.replace(/^\?/, '').split('&')) {
          if (part === '') continue
          const [key, value = ''] = part.split('=')
          this.#entries.push([decode(key), decode(value)])
        }
      } else if (init instanceof URLSearchParams) this.#entries = [...init]
      else {
        const entries = Symbol.iterator in init ? [...init] : Object.entries(init)
        this.#entries = entries.map(([key, value]) => [String(key), String(value)])
      }
    }

    append(key, value) {
      this.#entries.push([String(key), String(value)])
    }

    delete(key) {
      this.#entries = this.#entries.filter(([name]) => name !== key)
    }

    get(key) {
      return this.#entries.find(([name]) => name === key)?.[1] ?? null
    }

    getAll(key) {
      return this.#entries.filter(([name]) => name === key).map(([, value]) => value)
    }

    has(key) {
      return this.#entries.some(([name]) => name === key)
    }

    set(key, value) {
      this.delete(key)
      this.append(key, value)
    }

    forEach(callback) {
      for (const [key, value] of this.#entries) callback(value, key, this)
    }

    keys() {
      return this.#entries.map(([key]) => key).values()
    }

    values() {
      return this.#entries.map(([, value]) => value).values()
    }

    entries() {
      return this.#entries.values()
    }

    [Symbol.iterator]() {
      return this.entries()
    }

    toString() {
      return this.#entries
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&')
    }
  }

  const decode = (text) => decodeURIComponent(text.replace(/\+/g, ' '))

  const URL_PARTS =
    /^([a-z][a-z0-9+.-]*:)(?:\/\/(?:([^/?#@]*)@)?([^/?#:]*)(?::(\d+))?)?([^?#]*)(\?[^#]*)?(#.*)?$/i

  class URL {
    constructor(url, base) {
      let match = URL_PARTS.exec(String(url))
      if (match === null) {
        if (base === undefined) throw new TypeError(`Invalid URL: ${url}`)
        const parent = new URL(base)
        const path = String(url).startsWith('/')
          ? String(url)
          : parent.pathname.replace(/[^/]*$/, '') + url
        match = URL_PARTS.exec(`${parent.origin}${path}`)
      }
      const [, protocol, auth = '', hostname = '', port = '', pathname, search = '', hash = ''] =
        match
      const [username = '', password = ''] = auth.split(':')
      Object.assign(this, { protocol, username, password, hostname, port, search, hash })
      this.pathname = pathname || (hostname ? '/' : '')
      this.searchParams = new URLSearchParams(search)
    }

    get host() {
      return this.port === '' ? this.hostname : `${this.hostname}:${this.port}`
    }

    get origin() {
      return `${this.protocol}//${this.host}`
    }

    get href() {
      const auth = this.username === '' ? '' : `${this.username}:${this.password}@`
      return `${this.protocol}//${auth}${this.host}${this.pathname}${this.search}${this.hash}`
    }

    toString() {
      return this.href
    }

    toJSON() {
      return this.href
    }
  }

  global.URL = URL
  global.URLSearchParams = URLSearchParams

  /* What browsers and Node have of the web. */

  function AbortSignal() {
    EventEmitter.call(this)
    this.aborted = false
    this.reason = undefined
  }
  inherit(AbortSignal, EventEmitter, {
    addEventListener(name, listener) {
      this.on(name, listener)
    },
    removeEventListener(name, listener) {
      this.off(name, listener)
    },
    throwIfAborted() {
      if (this.aborted) throw this.reason
    },
  })

  global.AbortSignal = AbortSignal
  global.AbortController = class AbortController {
    signal = new AbortSignal()
    abort(reason = new Error('This operation was aborted')) {
      if (this.signal.aborted) return
      this.signal.aborted = true
      this.signal.reason = reason
      this.signal.emit('abort')
    }
  }
  global.performance = {
    now: () => host.clock() - startedAt,
    timeOrigin: 0,
    mark() {},
    measure() {},
  }
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value))

  /* Streams, enough for loggers and for what bundles extend. */

  function Stream(options) {
    EventEmitter.call(this, options)
  }
  inherit(Stream, EventEmitter, {
    pipe(target) {
      this.on('data', (chunk) => target.write(chunk))
      this.on('end', () => target.end?.())
      return target
    },
    destroy(error) {
      if (error) this.emit('error', error)
      this.emit('close')
      return this
    },
  })

  function Readable(options = {}) {
    Stream.call(this, options)
    this.readable = true
    if (options.read) this._read = options.read
  }
  const reading = {
    _read() {},
    read: () => null,
    push(chunk) {
      this.emit(...(chunk === null ? ['end'] : ['data', chunk]))
      return true
    },
    pause() {
      return this
    },
    resume() {
      return this
    },
    setEncoding() {
      return this
    },
  }
  inherit(Readable, Stream, reading)

  const writing = {
    _write(_chunk, _encoding, callback) {
      callback()
    },
    write(chunk, encoding, callback) {
      const done = typeof encoding === 'function' ? encoding : callback
      this._write(chunk, typeof encoding === 'string' ? encoding : 'utf8', (error) => {
        if (error) this.emit('error', error)
        done?.(error)
      })
      return true
    },
    end(chunk, encoding, callback) {
      if (typeof chunk === 'function') callback = chunk
      else if (chunk !== undefined && chunk !== null) this.write(chunk, encoding)
      const finish = () => {
        this.emit('finish')
        this.emit('close')
        callback?.()
      }
      if (this._final) this._final(finish)
      else finish()
      return this
    },
    cork() {},
    uncork() {},
  }

  function Writable(options = {}) {
    Stream.call(this, options)
    this.writable = true
    if (options.write) this._write = options.write
    if (options.final) this._final = options.final
  }
  inherit(Writable, Stream, writing)

  function Duplex(options = {}) {
    Readable.call(this, options)
    this.writable = true
    if (options.write) this._write = options.write
    if (options.final) this._final = options.final
  }
  inherit(Duplex, Readable, writing)

  function Transform(options = {}) {
    Duplex.call(this, options)
    if (options.transform) this._transform = options.transform
    if (options.flush) this._flush = options.flush
  }
  inherit(Transform, Duplex, {
    _transform(chunk, _encoding, callback) {
      callback(null, chunk)
    },
    _write(chunk, encoding, callback) {
      this._transform(chunk, encoding, (error, data) => {
        if (data !== undefined && data !== null) this.push(data)
        callback(error)
      })
    },
    _flush(callback) {
      callback()
    },
    _final(callback) {
      this._flush((error, data) => {
        if (data !== undefined && data !== null) this.push(data)
        this.push(null)
        callback(error)
      })
    },
  })

  function PassThrough(options) {
    Transform.call(this, options)
  }
  inherit(PassThrough, Transform)

  Object.assign(Stream, { Stream, Readable, Writable, Duplex, Transform, PassThrough })
  Stream.pipeline = (...streams) => {
    const callback = typeof streams.at(-1) === 'function' ? streams.pop() : undefined
    streams.reduce((from, to) => from.pipe(to))
    callback?.()
    return streams.at(-1)
  }
  Stream.finished = (_stream, callback) => callback?.()
  Stream.promises = { pipeline: async () => {}, finished: async () => {} }

  /* The modules of Node. */

  const inspect = (value) => {
    if (typeof value === 'string') return `'${value}'`
    if (typeof value !== 'object' || value === null) return String(value)
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const normalize = (path) => {
    const absolute = path.startsWith('/')
    const parts = []
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') parts.pop()
      else if (part !== '..' || !absolute) parts.push(part)
    }
    return (absolute ? '/' : '') + parts.join('/') || (absolute ? '/' : '.')
  }

  const pathModule = {
    sep: '/',
    delimiter: ';',
    normalize,
    join: (...parts) => normalize(parts.filter((part) => part !== '').join('/')),
    resolve: (...parts) => {
      let path = ''
      for (const part of parts.reverse()) {
        path = path === '' ? part : `${part}/${path}`
        if (part.startsWith('/') || /^[A-Za-z]:/.test(part)) break
      }
      return normalize(path)
    },
    dirname: (path) => {
      const at = path.replace(/[\\/]+$/, '').lastIndexOf('/')
      return at < 0 ? '.' : at === 0 ? '/' : path.slice(0, at)
    },
    basename: (path, extension) => {
      const name = path
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .at(-1)
      return extension && name.endsWith(extension) ? name.slice(0, -extension.length) : name
    },
    extname: (path) => /[^/\\.](\.[^/\\.]*)$/.exec(path)?.[1] ?? '',
    isAbsolute: (path) => path.startsWith('/') || /^[A-Za-z]:/.test(path),
    relative: (from, to) => {
      const start = normalize(from).split('/')
      const end = normalize(to).split('/')
      let same = 0
      while (same < start.length && start[same] === end[same]) same++
      return [...start.slice(same).map(() => '..'), ...end.slice(same)].join('/')
    },
    parse: (path) => {
      const base = pathModule.basename(path)
      const ext = pathModule.extname(path)
      return {
        root: path.startsWith('/') ? '/' : '',
        dir: pathModule.dirname(path),
        base,
        ext,
        name: base.slice(0, base.length - ext.length),
      }
    },
    format: ({ dir = '', base, name = '', ext = '' }) =>
      `${dir}${dir && '/'}${base ?? `${name}${ext}`}`,
  }
  pathModule.posix = pathModule
  pathModule.win32 = pathModule

  const util = {
    format: (first, ...rest) => {
      if (typeof first !== 'string') return [first, ...rest].map(inspect).join(' ')
      let used = 0
      const text = first.replace(/%[sdifjoO%]/g, (specifier) => {
        if (specifier === '%%') return '%'
        if (used >= rest.length) return specifier
        const value = rest[used++]
        if (specifier === '%s') return String(value)
        if (specifier === '%d' || specifier === '%f' || specifier === '%i')
          return String(Number(value))
        return inspect(value)
      })
      return [
        text,
        ...rest.slice(used).map((value) => (typeof value === 'string' ? value : inspect(value))),
      ].join(' ')
    },
    inspect: Object.assign(inspect, { custom: Symbol.for('nodejs.util.inspect.custom') }),
    inherits(child, parent) {
      child.super_ = parent
      Object.setPrototypeOf(child.prototype, parent.prototype)
    },
    promisify: Object.assign(
      (fn) =>
        (...args) =>
          new Promise((resolve, reject) => {
            fn(...args, (error, value) => (error ? reject(error) : resolve(value)))
          }),
      { custom: Symbol.for('nodejs.util.promisify.custom') },
    ),
    callbackify:
      (fn) =>
      (...args) => {
        const callback = args.pop()
        fn(...args).then(
          (value) => callback(null, value),
          (error) => callback(error),
        )
      },
    deprecate: (fn) => fn,
    debuglog: () => () => {},
    debug: () => () => {},
    stripVTControlCharacters: (text) => text.replace(/\u001b\[[0-9;]*m/g, ''),
    isArray: Array.isArray,
    isDeepStrictEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    TextEncoder: global.TextEncoder,
    TextDecoder: global.TextDecoder,
    types: {
      isPromise: (value) => value instanceof Promise,
      isDate: (value) => value instanceof Date,
      isRegExp: (value) => value instanceof RegExp,
      isMap: (value) => value instanceof Map,
      isSet: (value) => value instanceof Set,
      isTypedArray: (value) => ArrayBuffer.isView(value) && !(value instanceof DataView),
      isUint8Array: (value) => value instanceof Uint8Array,
      isArrayBuffer: (value) => value instanceof ArrayBuffer,
      isAnyArrayBuffer: (value) => value instanceof ArrayBuffer,
      isNativeError: (value) => value instanceof Error,
      isGeneratorFunction: () => false,
      isAsyncFunction: () => false,
    },
  }

  const assert = Object.assign(
    (value, message) => {
      if (!value) throw new Error(message ?? 'Assertion failed')
    },
    {
      equal(a, b, message) {
        if (a != b) throw new Error(message ?? `${inspect(a)} == ${inspect(b)}`)
      },
      strictEqual(a, b, message) {
        if (a !== b) throw new Error(message ?? `${inspect(a)} === ${inspect(b)}`)
      },
      deepStrictEqual(a, b, message) {
        if (!util.isDeepStrictEqual(a, b)) throw new Error(message ?? 'not deeply equal')
      },
    },
  )
  assert.ok = assert

  const fileError = (code, path) =>
    Object.assign(new Error(`${code}: no such file or directory, open '${path}'`), { code, path })

  const statOf = (path) => {
    const size = host.fileSize(path)
    const directory = size === undefined && host.listDirectory(path) !== undefined
    if (size === undefined && !directory) throw fileError('ENOENT', path)
    const now = new Date(host.wallClock())
    return {
      size: size ?? 0,
      isFile: () => !directory,
      isDirectory: () => directory,
      isSymbolicLink: () => false,
      mtime: now,
      ctime: now,
      atime: now,
      birthtime: now,
      mtimeMs: now.getTime(),
    }
  }

  const fs = {
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
    existsSync: (path) =>
      host.fileSize(String(path)) !== undefined || host.listDirectory(String(path)) !== undefined,
    readFileSync(path, options) {
      const data = host.readPath(String(path))
      if (data === undefined) throw fileError('ENOENT', path)
      const buffer = Buffer.from(data)
      const encoding = typeof options === 'string' ? options : options?.encoding
      return encoding ? buffer.toString(encoding) : buffer
    },
    writeFileSync(path, data) {
      const bytes = typeof data === 'string' ? Buffer.from(data) : data
      host.writePath(String(path), new Uint8Array(bytes).buffer)
    },
    appendFileSync(path, data) {
      const before = host.readPath(String(path))
      fs.writeFileSync(
        path,
        Buffer.concat([Buffer.from(before ?? new ArrayBuffer(0)), Buffer.from(data)]),
      )
    },
    mkdirSync: (path) => host.makeDirectory(String(path)),
    readdirSync: (path) => {
      const entries = host.listDirectory(String(path))
      if (entries === undefined) throw fileError('ENOENT', path)
      return entries
    },
    statSync: (path) => statOf(String(path)),
    lstatSync: (path) => statOf(String(path)),
    unlinkSync: (path) => host.removePath(String(path)),
    accessSync(path) {
      if (!fs.existsSync(path)) throw fileError('ENOENT', path)
    },
    createWriteStream(path) {
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          fs.appendFileSync(path, chunk)
          callback()
        },
      })
      Promise.resolve().then(() => stream.emit('open'))
      return stream
    },
    createReadStream(path) {
      const stream = new Readable()
      Promise.resolve().then(() => {
        stream.push(fs.readFileSync(path))
        stream.push(null)
      })
      return stream
    },
  }

  /** The asynchronous forms of the functions of fs, which take callbacks or give promises. */
  const later =
    (fn) =>
    (...args) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
      Promise.resolve().then(() => {
        try {
          callback?.(null, fn(...args))
        } catch (error) {
          callback?.(error)
        }
      })
    }
  fs.promises = {}
  for (const name of [
    'readFile',
    'writeFile',
    'appendFile',
    'mkdir',
    'readdir',
    'stat',
    'lstat',
    'unlink',
    'access',
  ]) {
    const sync = fs[`${name}Sync`]
    fs[name] = later(sync)
    fs.promises[name] = async (...args) => sync(...args)
  }

  const randomBytes = (size, callback) => {
    const bytes = new Buffer(size)
    for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256)
    if (callback) callback(null, bytes)
    return bytes
  }

  const hex = (size) => randomBytes(size).toString('hex')

  const digestOf = (algorithm, bytes) => {
    const name = String(algorithm).toLowerCase().replace('-', '')
    const digest = host.digest(name, new Uint8Array(bytes).buffer)
    if (digest === undefined) throw new Error('Digest method not supported')
    return Buffer.from(digest, 'hex')
  }

  class Hash {
    #algorithm
    #chunks = []

    constructor(algorithm) {
      digestOf(algorithm, [])
      this.#algorithm = algorithm
    }

    update(data, encoding) {
      this.#chunks.push(typeof data === 'string' ? Buffer.from(data, encoding) : Buffer.from(data))
      return this
    }

    digest(encoding) {
      const bytes = digestOf(this.#algorithm, Buffer.concat(this.#chunks))
      return encoding === undefined ? bytes : bytes.toString(encoding)
    }
  }

  class Hmac extends Hash {
    #outer

    constructor(algorithm, key) {
      super(algorithm)
      const size = /384|512/.test(algorithm) ? 128 : 64
      const given = Buffer.from(key)
      const secret = given.length > size ? digestOf(algorithm, given) : given
      const padded = (mask) => Buffer.alloc(size).map((_byte, i) => (secret[i] ?? 0) ^ mask)
      this.update(padded(0x36))
      this.#outer = new Hash(algorithm).update(padded(0x5c))
    }

    digest(encoding) {
      return this.#outer.update(super.digest()).digest(encoding)
    }
  }

  const crypto = {
    randomBytes,
    randomUUID: () => `${hex(4)}-${hex(2)}-4${hex(2).slice(1)}-a${hex(2).slice(1)}-${hex(6)}`,
    getRandomValues: (array) => {
      for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 256)
      return array
    },
    randomInt: (min, max) =>
      max === undefined
        ? Math.floor(Math.random() * min)
        : min + Math.floor(Math.random() * (max - min)),
    createHash: (algorithm) => new Hash(algorithm),
    createHmac: (algorithm, key) => new Hmac(algorithm, key),
  }

  global.crypto = crypto

  class StringDecoder {
    write(buffer) {
      return Buffer.from(buffer).toString()
    }
    end(buffer) {
      return buffer ? this.write(buffer) : ''
    }
  }

  /** A class of what reaches the machine, which connects to nothing. */
  function Unreachable(options) {
    EventEmitter.call(this, options)
  }
  inherit(Unreachable, EventEmitter, {
    destroy() {},
    end() {},
    setTimeout() {},
    setKeepAlive() {},
    setNoDelay() {},
    write: () => false,
  })

  /* The port of MySQL, where FiveRunner's database answers, as bundles carry mysql2 with them. */

  const MYSQL_PORT = 3306
  const CAPABILITIES = 0x1 | 0x2 | 0x4 | 0x8 | 0x200 | 0x2000 | 0x8000 | 0x20000 | 0x40000 | 0x80000
  const FIELD_TYPES = {
    TINY: 1,
    SHORT: 2,
    LONG: 3,
    FLOAT: 4,
    DOUBLE: 5,
    NULL: 6,
    TIMESTAMP: 7,
    LONGLONG: 8,
    INT24: 9,
    DATE: 10,
    TIME: 11,
    DATETIME: 12,
    YEAR: 13,
    BIT: 16,
    NEWDECIMAL: 246,
    BLOB: 252,
    VAR_STRING: 253,
    STRING: 254,
  }
  const INTEGER_SIZES = { TINY: 1, SHORT: 2, YEAR: 2, INT24: 4, LONG: 4, LONGLONG: 8 }
  const TEXT_FIELDS = ['BLOB', 'VAR_STRING', 'STRING']

  const lengthEncoded = (value) => {
    if (value < 251) return Buffer.from([value])
    if (value < 0x10000) return Buffer.from([0xfc, value & 255, value >> 8])
    return Buffer.from([0xfd, value & 255, (value >> 8) & 255, value >> 16])
  }
  const encodedText = (text) => {
    const bytes = Buffer.from(String(text))
    return Buffer.concat([lengthEncoded(bytes.length), bytes])
  }
  const OK = Buffer.from([0, 0, 0, 2, 0, 0, 0])
  const EOF = Buffer.from([0xfe, 0, 0, 2, 0])

  /** What the MySQL protocol reads of the payload of a command. */
  class Reader {
    at = 0
    constructor(bytes) {
      this.bytes = bytes
    }
    uint(size) {
      let value = 0
      for (let i = 0; i < size; i++) value += this.bytes[this.at + i] * 2 ** (8 * i)
      this.at += size
      return value
    }
    length() {
      const first = this.uint(1)
      if (first < 0xfb) return first
      return this.uint(first === 0xfc ? 2 : first === 0xfd ? 3 : 8)
    }
    text() {
      const length = this.length()
      this.at += length
      return this.bytes.toString('utf8', this.at - length, this.at)
    }
    /** A value of a parameter that mysql2 bound, by its type. */
    value(type) {
      const { bytes } = this
      switch (type) {
        case 1:
          return this.uint(1)
        case 2:
          return this.uint(2)
        case 3:
          return this.uint(4) | 0
        case 8:
          this.at += 8
          return Number(bytes.readBigInt64LE(this.at - 8))
        case 4:
          this.at += 4
          return bytes.readFloatLE(this.at - 4)
        case 5:
          this.at += 8
          return bytes.readDoubleLE(this.at - 8)
        case 7:
        case 10:
        case 12: {
          const length = this.uint(1)
          const parts = [0, 0, 0, 0, 0, 0]
          if (length >= 4) {
            parts[0] = this.uint(2)
            parts[1] = this.uint(1)
            parts[2] = this.uint(1)
          }
          if (length >= 7) for (let i = 3; i < 6; i++) parts[i] = this.uint(1)
          if (length === 11) this.at += 4
          const pad = (value) => String(value).padStart(2, '0')
          return `${parts[0]}-${pad(parts[1])}-${pad(parts[2])} ${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`
        }
        default:
          return this.text()
      }
    }
  }

  /** The placeholders of a statement, those out of its strings. */
  const placeholders = (sql) =>
    sql.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, '').split('?').length - 1

  function columnDefinition({ name, field, decimals, unsigned, binary }) {
    const tail = Buffer.alloc(13)
    tail[0] = 12
    tail.writeUInt16LE(TEXT_FIELDS.includes(field) && !binary ? 33 : 63, 1)
    tail.writeUInt32LE(0xffffff, 3)
    tail[7] = FIELD_TYPES[field]
    tail.writeUInt16LE((unsigned ? 0x20 : 0) | (binary ? 0x80 : 0), 8)
    tail[10] = Math.min(decimals, 31)
    return Buffer.concat(['def', '', '', '', name, name].map(encodedText).concat(tail))
  }

  /** A connection to the port of MySQL, as the server end of its protocol, on FiveRunner's database. */
  function DatabaseSocket() {
    EventEmitter.call(this)
    this.incoming = Buffer.alloc(0)
    this.statements = new Map()
    this.nextStatement = 1
    this.writable = true
    this.readable = true
    const open = () => {
      if (!host.databaseReady()) return global.setTimeout(open, 50)
      this.emit('connect')
      return this.greet()
    }
    global.setImmediate(open)
  }
  inherit(DatabaseSocket, EventEmitter, {
    setNoDelay() {},
    setKeepAlive() {},
    setTimeout() {},
    ref() {},
    unref() {},
    pause() {},
    resume() {},
    end() {
      this.emit('close')
    },
    destroy() {
      this.emit('close')
    },
    send(sequence, payloads) {
      const packets = payloads.map((payload, index) => {
        const header = Buffer.alloc(4)
        header.writeUInt16LE(payload.length & 0xffff, 0)
        header[2] = payload.length >> 16
        header[3] = (sequence + index) & 255
        return Buffer.concat([header, payload])
      })
      global.setImmediate(() => this.emit('data', Buffer.concat(packets)))
    },
    greet() {
      const salt = Buffer.from('fiverunnerfiverunner')
      const head = Buffer.from([
        10,
        ...Buffer.from('11.4.0-MariaDB-FiveRunner'),
        0,
        1,
        0,
        0,
        0,
        ...salt.subarray(0, 8),
        0,
        CAPABILITIES & 255,
        (CAPABILITIES >> 8) & 255,
        33,
        2,
        0,
        (CAPABILITIES >> 16) & 255,
        (CAPABILITIES >> 24) & 255,
        21,
        ...new Array(10).fill(0),
        ...salt.subarray(8),
        0,
        ...Buffer.from('mysql_native_password'),
        0,
      ])
      this.send(0, [head])
    },
    write(data, encoding, callback) {
      this.incoming = Buffer.concat([this.incoming, data])
      while (this.incoming.length >= 4) {
        const length = this.incoming[0] | (this.incoming[1] << 8) | (this.incoming[2] << 16)
        if (this.incoming.length < length + 4) break
        const sequence = this.incoming[3]
        const payload = this.incoming.subarray(4, 4 + length)
        this.incoming = this.incoming.subarray(4 + length)
        this.command(sequence, payload)
      }
      const done = typeof encoding === 'function' ? encoding : callback
      done?.()
      return true
    },
    command(sequence, payload) {
      // The first packet of a connection is the response to the greeting, whatever its password.
      if (!this.greeted) {
        this.greeted = true
        return this.send(sequence + 1, [OK])
      }
      const reader = new Reader(payload)
      switch (reader.uint(1)) {
        case 0x03:
          return this.reply(sequence, payload.toString('utf8', 1), [], false)
        case 0x16:
          return this.prepare(sequence, payload.toString('utf8', 1))
        case 0x17:
          return this.execute(sequence, reader)
        case 0x01:
          return this.emit('close')
        case 0x19:
          return undefined
        default:
          return this.send(sequence + 1, [OK])
      }
    },
    prepare(sequence, sql) {
      const id = this.nextStatement++
      const count = placeholders(sql)
      this.statements.set(id, { sql, count, types: [] })
      const head = Buffer.alloc(12)
      head.writeUInt32LE(id, 1)
      head.writeUInt16LE(count, 7)
      const parameter = columnDefinition({ name: '?', field: 'VAR_STRING', decimals: 0 })
      const parameters = new Array(count).fill(parameter)
      this.send(sequence + 1, [head, ...parameters, ...(count > 0 ? [EOF] : [])])
    },
    execute(sequence, reader) {
      const statement = this.statements.get(reader.uint(4))
      reader.at += 5
      const { count } = statement
      const nulls = reader.bytes.subarray(reader.at, reader.at + ((count + 7) >> 3))
      if (count > 0) {
        reader.at += nulls.length
        if (reader.uint(1) === 1) {
          statement.types = Array.from({ length: count }, () => reader.uint(2) & 255)
        }
      }
      const values = statement.types.map((type, index) =>
        nulls[index >> 3] & (1 << (index & 7)) ? null : reader.value(type),
      )
      this.reply(sequence, statement.sql, values, true)
    },
    reply(sequence, sql, values, binary) {
      const result = JSON.parse(host.runStatement(sql, JSON.stringify(values)))
      if (result.error !== undefined) {
        const { message, errno = 1064, sqlState = '42000' } = result.error
        const code = Buffer.alloc(3)
        code[0] = 0xff
        code.writeUInt16LE(errno, 1)
        const payload = Buffer.concat([code, Buffer.from(`#${sqlState}${message}`)])
        return this.send(sequence + 1, [payload])
      }
      if (result.columns === undefined) {
        const payload = Buffer.concat([
          Buffer.from([0]),
          lengthEncoded(result.affectedRows),
          lengthEncoded(result.insertId),
          Buffer.from([2, 0, 0, 0]),
        ])
        return this.send(sequence + 1, [payload])
      }
      const { columns, rows } = result
      const encode = binary ? binaryRow : textRow
      return this.send(sequence + 1, [
        lengthEncoded(columns.length),
        ...columns.map(columnDefinition),
        EOF,
        ...rows.map((row) => encode(row, columns)),
        EOF,
      ])
    },
  })

  function textCell(value, { binary }) {
    const bytes = Buffer.from(value, binary ? 'latin1' : 'utf8')
    return Buffer.concat([lengthEncoded(bytes.length), bytes])
  }

  function textRow(row, columns) {
    const cells = row.map((value, index) =>
      value === null ? Buffer.from([0xfb]) : textCell(value, columns[index]),
    )
    return Buffer.concat(cells)
  }

  /** A date of the binary protocol: its length, then year, month, day, time and microseconds. */
  function dateCell(text) {
    const [, year, month, day, hour = 0, minute = 0, second = 0, fraction = ''] =
      /^(\d+)-(\d+)-(\d+)(?: (\d+):(\d+):(\d+)(?:\.(\d+))?)?$/.exec(text)
    const micros = Number(fraction.padEnd(6, '0'))
    const cell = Buffer.alloc(12)
    cell[0] = micros > 0 ? 11 : 7
    cell.writeUInt16LE(Number(year), 1)
    cell.set([month, day, hour, minute, second], 3)
    cell.writeUInt32LE(micros, 8)
    return cell.subarray(0, 1 + cell[0])
  }

  /** A time of the binary protocol: its length, its sign, then days, time and microseconds. */
  function timeCell(text) {
    const [, sign, hours, minutes, seconds, fraction = ''] =
      /^(-?)(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(text)
    const micros = Number(fraction.padEnd(6, '0'))
    const cell = Buffer.alloc(13)
    cell[0] = micros > 0 ? 12 : 8
    cell[1] = sign === '-' ? 1 : 0
    cell.writeUInt32LE(Math.floor(hours / 24), 2)
    cell.set([hours % 24, minutes, seconds], 6)
    cell.writeUInt32LE(micros, 9)
    return cell.subarray(0, 1 + cell[0])
  }

  function binaryCell(value, column) {
    const { field } = column
    if (field in INTEGER_SIZES) {
      const cell = Buffer.alloc(8)
      cell.writeBigInt64LE(BigInt.asIntN(64, BigInt(value)))
      return cell.subarray(0, INTEGER_SIZES[field])
    }
    switch (field) {
      case 'FLOAT': {
        const cell = Buffer.alloc(4)
        cell.writeFloatLE(Number(value))
        return cell
      }
      case 'DOUBLE': {
        const cell = Buffer.alloc(8)
        cell.writeDoubleLE(Number(value))
        return cell
      }
      case 'DATE':
      case 'DATETIME':
      case 'TIMESTAMP':
        return dateCell(value)
      case 'TIME':
        return timeCell(value)
      default:
        return textCell(value, column)
    }
  }

  function binaryRow(row, columns) {
    const nulls = Buffer.alloc((row.length + 9) >> 3)
    const cells = row.map((value, index) => {
      if (value !== null) return binaryCell(value, columns[index])
      nulls[(index + 2) >> 3] |= 1 << ((index + 2) & 7)
      return Buffer.alloc(0)
    })
    return Buffer.concat([Buffer.from([0]), nulls, ...cells])
  }

  /** The port of the database of the server, as its connection string names it. */
  const databasePort = () =>
    Number(
      /(?:@[^/:]*:|port=)(\d+)/i.exec(global.GetConvar('mysql_connection_string', ''))?.[1] ??
        MYSQL_PORT,
    )

  /** What net.connect gives: FiveRunner's database on the port of MySQL, and otherwise a socket that fails. */
  function connect(...args) {
    const options = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] }
    if (Number(options.port) === databasePort()) return new DatabaseSocket()
    const socket = new Unreachable()
    global.setImmediate(() => {
      const error = new Error(`connect ECONNREFUSED ${options.host}:${options.port}`)
      socket.emit('error', Object.assign(error, { code: 'ECONNREFUSED' }))
    })
    return socket
  }

  const unreachable = (name) => () => {
    throw new Error(`FiveRunner does not run ${name} for JavaScript resources`)
  }

  const httpModule = (name) => ({
    Agent: Unreachable,
    Server: Unreachable,
    ClientRequest: Unreachable,
    IncomingMessage: Readable,
    OutgoingMessage: Writable,
    ServerResponse: Writable,
    STATUS_CODES: {},
    METHODS: [],
    globalAgent: new Unreachable(),
    request: unreachable(`${name}.request`),
    get: unreachable(`${name}.get`),
    createServer: unreachable(`${name}.createServer`),
  })

  const BUILTINS = {
    assert: () => assert,
    buffer: () => ({
      Buffer: global.Buffer,
      constants: { MAX_LENGTH: 2 ** 31 - 1, MAX_STRING_LENGTH: 2 ** 29 },
      kMaxLength: 2 ** 31 - 1,
      Blob: class Blob {},
      File: class File {},
    }),
    child_process: () => ({
      spawn: unreachable('child_process.spawn'),
      exec: unreachable('child_process.exec'),
      execSync: unreachable('child_process.execSync'),
    }),
    cluster: () => ({ isMaster: true, isPrimary: true, isWorker: false, on() {} }),
    constants: () => ({}),
    crypto: () => crypto,
    dgram: () => ({ createSocket: unreachable('dgram.createSocket') }),
    dns: () => ({ lookup: unreachable('dns.lookup'), promises: {} }),
    domain: () => ({ create: () => new EventEmitter(), active: null }),
    events: () => EventEmitter,
    fs: () => fs,
    'fs/promises': () => fs.promises,
    http: () => httpModule('http'),
    http2: () => ({ constants: {}, connect: unreachable('http2.connect') }),
    https: () => httpModule('https'),
    module: () => ({ builtinModules: Object.keys(BUILTINS), createRequire: () => global.require }),
    net: () => ({
      Socket: Unreachable,
      Server: Unreachable,
      isIP: (text) => (/^\d+\.\d+\.\d+\.\d+$/.test(text) ? 4 : text.includes(':') ? 6 : 0),
      isIPv4: (text) => /^\d+\.\d+\.\d+\.\d+$/.test(text),
      isIPv6: (text) => text.includes(':'),
      connect,
      createConnection: connect,
      createServer: unreachable('net.createServer'),
    }),
    os: () => ({
      EOL: '\n',
      platform: () => 'win32',
      type: () => 'Windows_NT',
      arch: () => 'x64',
      release: () => '10.0',
      hostname: () => 'fiverunner',
      homedir: () => '/',
      tmpdir: () => '/tmp',
      endianness: () => 'LE',
      cpus: () => [],
      totalmem: () => 0,
      freemem: () => 0,
      loadavg: () => [0, 0, 0],
      uptime: () => 0,
      networkInterfaces: () => ({}),
      userInfo: () => ({ username: 'fiverunner', uid: 0, gid: 0, shell: null, homedir: '/' }),
      constants: { signals: {}, errno: {} },
    }),
    path: () => pathModule,
    'path/posix': () => pathModule,
    perf_hooks: () => ({ performance: global.performance, PerformanceObserver: class {} }),
    process: () => global.process,
    punycode: () => ({ toASCII: (text) => text, toUnicode: (text) => text }),
    querystring: () => ({
      parse: (text) => Object.fromEntries(new URLSearchParams(text)),
      stringify: (object) => new URLSearchParams(object).toString(),
      escape: encodeURIComponent,
      unescape: decodeURIComponent,
    }),
    readline: () => ({ createInterface: unreachable('readline.createInterface') }),
    stream: () => Stream,
    'stream/promises': () => Stream.promises,
    'stream/web': () => ({
      ReadableStream: class {},
      TransformStream: class {},
      WritableStream: class {},
    }),
    string_decoder: () => ({ StringDecoder }),
    timers: () => ({
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
      setInterval: global.setInterval,
      clearInterval: global.clearInterval,
      setImmediate: global.setImmediate,
      clearImmediate: global.clearImmediate,
    }),
    'timers/promises': () => ({
      setTimeout: (delay, value) => new Promise((done) => global.setTimeout(done, delay, value)),
      setImmediate: (value) => new Promise((done) => global.setImmediate(done, value)),
    }),
    tls: () => ({
      TLSSocket: Unreachable,
      Server: Unreachable,
      connect: unreachable('tls.connect'),
      createSecureContext: () => ({}),
      rootCertificates: [],
    }),
    tty: () => ({ isatty: () => false, ReadStream: Readable, WriteStream: Writable }),
    url: () => ({
      URL,
      URLSearchParams,
      parse: (text) => new URL(text, 'file:///'),
      format: (url) => String(url.href ?? url),
      fileURLToPath: (url) => new URL(url).pathname,
      pathToFileURL: (path) => new URL(`file://${path}`),
    }),
    util: () => util,
    'util/types': () => util.types,
    v8: () => ({ getHeapStatistics: () => ({}) }),
    vm: () => ({ runInThisContext: unreachable('vm.runInThisContext') }),
    worker_threads: () => ({
      isMainThread: true,
      parentPort: null,
      workerData: null,
      Worker: Unreachable,
    }),
    zlib: () => ({
      constants: {},
      createGzip: unreachable('zlib.createGzip'),
      createGunzip: unreachable('zlib.createGunzip'),
      createDeflate: unreachable('zlib.createDeflate'),
      createInflate: unreachable('zlib.createInflate'),
      gzipSync: unreachable('zlib.gzipSync'),
      gunzipSync: unreachable('zlib.gunzipSync'),
    }),
    async_hooks: () => ({
      AsyncLocalStorage: class AsyncLocalStorage {
        #store
        run(store, callback, ...args) {
          const before = this.#store
          this.#store = store
          try {
            return callback(...args)
          } finally {
            this.#store = before
          }
        }
        getStore() {
          return this.#store
        }
        enterWith(store) {
          this.#store = store
        }
        exit(callback, ...args) {
          return this.run(undefined, callback, ...args)
        }
      },
      AsyncResource: class AsyncResource {
        runInAsyncScope(callback, self, ...args) {
          return callback.apply(self, args)
        }
      },
      createHook: () => ({ enable() {}, disable() {} }),
      executionAsyncId: () => 0,
      triggerAsyncId: () => 0,
    }),
    inspector: () => ({ open() {}, close() {} }),
    diagnostics_channel: () => ({
      channel: () => ({ hasSubscribers: false, publish() {}, subscribe() {} }),
      hasSubscribers: () => false,
      subscribe() {},
      tracingChannel: () => ({}),
    }),
  }

  const loaded = new Map()

  /** Runs a CommonJS module of the resource, whose require finds modules from where it is. */
  function loadFile(path, source) {
    const module = { exports: {}, id: path, filename: path, loaded: false, paths: [], children: [] }
    loaded.set(path, module)
    const dirname = pathModule.dirname(path)
    if (path.endsWith('.json')) {
      module.exports = JSON.parse(source)
      return module
    }
    const run = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      `${source}\n//# sourceURL=${path}`,
    )
    run.call(module.exports, module.exports, requireFrom(dirname), module, path, dirname)
    module.loaded = true
    return module
  }

  /**
   * The path of a file that a request names from a directory, as Node finds them.
   *
   * shortcut: reads main of package.json but not exports, read it once a package needs it.
   */
  function resolveFile(base) {
    const candidates = [base, `${base}.js`, `${base}.json`, `${base}/index.js`]
    const main = host.readPath(`${base}/package.json`)
    if (main !== undefined) {
      const entry = JSON.parse(new TextDecoder().decode(main)).main ?? 'index.js'
      candidates.unshift(pathModule.join(base, entry), `${pathModule.join(base, entry)}.js`)
    }
    return candidates.find((path) => host.fileSize(path) !== undefined)
  }

  function resolveModule(request, from) {
    if (request.startsWith('.') || request.startsWith('/')) {
      return resolveFile(pathModule.resolve(from, request))
    }
    for (let directory = from; ; directory = pathModule.dirname(directory)) {
      const found = resolveFile(`${directory}/node_modules/${request}`)
      if (found !== undefined) return found
      if (directory === '.' || directory === '/' || pathModule.dirname(directory) === directory) {
        return undefined
      }
    }
  }

  function requireFrom(directory) {
    const require = (request) => {
      const name = String(request).replace(/^node:/, '')
      if (Object.hasOwn(BUILTINS, name)) {
        if (!loaded.has(name)) loaded.set(name, { exports: BUILTINS[name]() })
        return loaded.get(name).exports
      }
      const path = resolveModule(request, directory)
      if (path === undefined) {
        const error = new Error(`Cannot find module '${request}'`)
        error.code = 'MODULE_NOT_FOUND'
        throw error
      }
      const module = loaded.get(path)
      if (module !== undefined) return module.exports
      return loadFile(path, new TextDecoder().decode(host.readPath(path))).exports
    }
    require.resolve = (request) => resolveModule(request, directory) ?? request
    require.cache = {}
    require.main = undefined
    return require
  }

  const root = host.resourcePath
  global.require = requireFrom(root)
  global.module = { exports: {}, id: '.', filename: `${root}/index.js`, paths: [], children: [] }
  global.__dirname = root
  global.__filename = `${root}/index.js`
})(globalThis, globalThis.__fiverunner)

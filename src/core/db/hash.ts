/**
 * The digests that MD5, SHA1, SHA2 and CRC32 give, computed in JavaScript,
 * as browsers compute none of them at once.
 */

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The message padded as MD5 and SHA pad it: a one bit, zeros, and its length in bits, little-endian for MD5. */
function pad(
  message: Uint8Array,
  blockSize: number,
  lengthBytes: number,
  littleEndian: boolean,
): Uint8Array {
  const length = message.length + 1 + lengthBytes
  const total = Math.ceil(length / blockSize) * blockSize
  const padded = new Uint8Array(total)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  const bits = BigInt(message.length) * 8n
  if (littleEndian) view.setBigUint64(total - 8, bits, true)
  else view.setBigUint64(total - 8, bits, false)
  return padded
}

const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const MD5_K = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
)

export function md5(message: Uint8Array): string {
  const padded = pad(message, 64, 8, true)
  const view = new DataView(padded.buffer)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  for (let offset = 0; offset < padded.length; offset += 64) {
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const shift = MD5_SHIFTS[(i >> 4) * 4 + (i % 4)]!
      const sum = (a + f + MD5_K[i]! + view.getUint32(offset + g * 4, true)) >>> 0
      a = d
      d = c
      c = b
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  const digest = new Uint8Array(16)
  const out = new DataView(digest.buffer)
  ;[a0, b0, c0, d0].forEach((word, i) => out.setUint32(i * 4, word, true))
  return hex(digest)
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

export function sha1(message: Uint8Array): string {
  const padded = pad(message, 64, 8, false)
  const view = new DataView(padded.buffer)
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const w = new Uint32Array(80)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 80; i++)
      w[i] = rotateLeft(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1)
    let [a, b, c, d, e] = h as [number, number, number, number, number]
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotateLeft(a, 5) + f + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = temp
    }
    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
  }
  return h.map((word) => word.toString(16).padStart(8, '0')).join('')
}

/** The first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const SHA256_K = new Uint32Array(64)
/** The first 64 bits of the fractional parts of the cube roots of the first 80 primes. */
const SHA512_K: bigint[] = []
{
  const primes: number[] = []
  for (let n = 2; primes.length < 80; n++) if (primes.every((p) => n % p !== 0)) primes.push(n)
  primes.forEach((prime, i) => {
    const bits = fractionBits(prime, 3)
    if (i < 64) SHA256_K[i] = Number(bits >> 32n)
    SHA512_K.push(bits)
  })
}

/** The first 64 bits of the fraction of the `degree`th root of a prime, computed exactly with integers. */
function fractionBits(prime: number, degree: number): bigint {
  // The root of prime * 2^(64 * degree) is the root times 2^64, whose low 64 bits are the fraction's.
  const target = BigInt(prime) << BigInt(64 * degree)
  let low = 0n
  let high = 1n << 70n
  while (low < high) {
    const mid = (low + high + 1n) >> 1n
    if (mid ** BigInt(degree) <= target) low = mid
    else high = mid - 1n
  }
  return low & ((1n << 64n) - 1n)
}

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0
}

function sha256(message: Uint8Array, initial: readonly number[], words: number): string {
  const padded = pad(message, 64, 8, false)
  const view = new DataView(padded.buffer)
  const h = [...initial]
  const w = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotateRight(w[i - 15]!, 7) ^ rotateRight(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotateRight(w[i - 2]!, 17) ^ rotateRight(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + s1 + ch + SHA256_K[i]! + w[i]!) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    ;[a, b, c, d, e, f, g, hh].forEach((value, i) => (h[i] = (h[i]! + value) >>> 0))
  }
  return h
    .slice(0, words)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('')
}

const MASK64 = (1n << 64n) - 1n

function rotateRight64(value: bigint, bits: bigint): bigint {
  return ((value >> bits) | (value << (64n - bits))) & MASK64
}

function sha512(message: Uint8Array, initial: readonly bigint[], words: number): string {
  const padded = pad(message, 128, 16, false)
  const view = new DataView(padded.buffer)
  const h = [...initial]
  const w: bigint[] = new Array(80)
  for (let offset = 0; offset < padded.length; offset += 128) {
    for (let i = 0; i < 16; i++) w[i] = view.getBigUint64(offset + i * 8)
    for (let i = 16; i < 80; i++) {
      const s0 = rotateRight64(w[i - 15]!, 1n) ^ rotateRight64(w[i - 15]!, 8n) ^ (w[i - 15]! >> 7n)
      const s1 = rotateRight64(w[i - 2]!, 19n) ^ rotateRight64(w[i - 2]!, 61n) ^ (w[i - 2]! >> 6n)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) & MASK64
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ]
    for (let i = 0; i < 80; i++) {
      const s1 = rotateRight64(e, 14n) ^ rotateRight64(e, 18n) ^ rotateRight64(e, 41n)
      const ch = (e & f) ^ (~e & MASK64 & g)
      const temp1 = (hh + s1 + ch + SHA512_K[i]! + w[i]!) & MASK64
      const s0 = rotateRight64(a, 28n) ^ rotateRight64(a, 34n) ^ rotateRight64(a, 39n)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) & MASK64
      hh = g
      g = f
      f = e
      e = (d + temp1) & MASK64
      d = c
      c = b
      b = a
      a = (temp1 + temp2) & MASK64
    }
    ;[a, b, c, d, e, f, g, hh].forEach((value, i) => (h[i] = (h[i]! + value) & MASK64))
  }
  return h
    .map((word) => word.toString(16).padStart(16, '0'))
    .join('')
    .slice(0, words * 16)
}

/** The initial values of SHA-256 and SHA-224. */
const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]
const SHA224_INITIAL = [
  0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4,
]
const SHA512_INITIAL = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
]
const SHA384_INITIAL = [
  0xcbbb9d5dc1059ed8n,
  0x629a292a367cd507n,
  0x9159015a3070dd17n,
  0x152fecd8f70e5939n,
  0x67332667ffc00b31n,
  0x8eb44a8768581511n,
  0xdb0c2e0d64f98fa7n,
  0x47b5481dbefa4fa4n,
]

/** The digest SHA2 gives for `bits`: 224, 256, 384 or 512, with 0 for 256, or undefined for others. */
export function sha2(message: Uint8Array, bits: number): string | undefined {
  switch (bits) {
    case 224:
      return sha256(message, SHA224_INITIAL, 7)
    case 0:
    case 256:
      return sha256(message, SHA256_INITIAL, 8)
    case 384:
      return sha512(message, SHA384_INITIAL, 6)
    case 512:
      return sha512(message, SHA512_INITIAL, 8)
    default:
      return undefined
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(message: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of message) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

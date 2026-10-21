/**
 * A pool of slots, as FiveM's server keeps the script GUIDs of entities:
 * each slot has a byte of a 7-bit id, which goes up each time the slot is
 * taken, and a bit for whether it is free. A slot is named by its index
 * and its byte, so handles to slots that were freed, or taken again, name
 * nothing. The lowest free slot is taken first, and full pools grow by half.
 */
export class Pool<T> {
  readonly #bytes: number[] = []
  readonly #items: (T | undefined)[] = []
  /** Where FiveM's pool starts to look for a free slot: those below it are all taken. */
  #firstFree = 0

  /** A pool of `size` free slots. */
  constructor(size: number) {
    this.#grow(size)
  }

  /** How many slots the pool has. */
  get size(): number {
    return this.#bytes.length
  }

  /** Takes the lowest free slot for `item`, after it grows the pool if it is full, and returns its handle. */
  add(item: T): number {
    let index = this.#firstFree
    while (index < this.#bytes.length && (this.#bytes[index]! & 0x80) === 0) index++
    if (index === this.#bytes.length) this.#grow(Math.max(index + Math.trunc(index / 2), index + 1))
    this.#firstFree = index + 1
    // The id of the slot goes up in its 7 bits, and the slot is no longer free.
    this.#bytes[index] = (this.#bytes[index]! + 1) & 0x7f
    this.#items[index] = item
    return (index << 8) | this.#bytes[index]!
  }

  /** The item that `handle` names, if its slot holds it still. */
  get(handle: number): T | undefined {
    const index = handle >> 8
    // Out of the pool, there is no byte for the handle to match.
    return this.#bytes[index] === (handle & 0xff) ? this.#items[index] : undefined
  }

  /** Puts `item` in the slot of a handle that the pool gave, which holds what the handle names. */
  set(handle: number, item: T): void {
    this.#items[handle >> 8] = item
  }

  /** Frees the slot of a handle that the pool gave, whatever its byte is now. */
  delete(handle: number): void {
    const index = handle >> 8
    this.#bytes[index] = this.#bytes[index]! | 0x80
    this.#items[index] = undefined
    this.#firstFree = Math.min(this.#firstFree, index)
  }

  #grow(size: number): void {
    while (this.#bytes.length < size) {
      this.#bytes.push(0x80)
      this.#items.push(undefined)
    }
  }
}

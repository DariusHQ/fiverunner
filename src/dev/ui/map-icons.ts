/**
 * The icons that the styles of the map draw blips with, by what the sprites
 * of the blips stand for: FiveRunner's own drawings, on a grid of 16 units
 * centred on the origin, of shapes that they fill and lines that they stroke.
 */
export type Icon =
  | 'anchor'
  | 'anvil'
  | 'badge'
  | 'basket'
  | 'boat'
  | 'bottle'
  | 'car'
  | 'cross'
  | 'cutlery'
  | 'dollar'
  | 'flag'
  | 'fuel'
  | 'gun'
  | 'heart'
  | 'house'
  | 'lock'
  | 'parking'
  | 'pill'
  | 'plane'
  | 'scissors'
  | 'shirt'
  | 'spray'
  | 'syringe'
  | 'wrench'

/** What the sprites of blips that FiveRunner knows of stand for. */
const SPRITES: ReadonlyMap<number, Icon> = new Map([
  [8, 'flag'],
  [40, 'house'],
  [50, 'car'],
  [52, 'basket'],
  [56, 'badge'],
  [59, 'basket'],
  [60, 'badge'],
  [61, 'cross'],
  [67, 'car'],
  [68, 'lock'],
  [71, 'scissors'],
  [72, 'spray'],
  [73, 'shirt'],
  [75, 'heart'],
  [93, 'bottle'],
  [102, 'syringe'],
  [108, 'dollar'],
  [110, 'gun'],
  [198, 'car'],
  [225, 'car'],
  [273, 'cutlery'],
  [326, 'car'],
  [356, 'boat'],
  [357, 'parking'],
  [359, 'plane'],
  [360, 'plane'],
  [361, 'fuel'],
  [366, 'shirt'],
  [402, 'wrench'],
  [403, 'pill'],
  [423, 'plane'],
  [424, 'plane'],
  [427, 'boat'],
  [477, 'car'],
  [566, 'anvil'],
  [729, 'anchor'],
])

/** The icon of the sprite of a blip, if FiveRunner knows what it stands for. */
export function iconOf(sprite: number): Icon | undefined {
  return SPRITES.get(sprite)
}

/** A part of an icon: a shape that it fills, or a line that it strokes, `width` units wide. */
interface Mark {
  readonly path: Path2D
  readonly width?: number
}

/** Adds a polygon of `points`, x then y, to `path`: clockwise for a shape, anticlockwise for a hole in one. */
function polygon(path: Path2D, points: readonly number[], hole = false): void {
  let area = 0
  for (let i = 0; i < points.length; i += 2) {
    const j = (i + 2) % points.length
    area += points[i]! * points[j + 1]! - points[j]! * points[i + 1]!
  }
  const order = [...Array(points.length / 2).keys()]
  // On a canvas, whose y goes down, clockwise turns have a positive area.
  if (area > 0 === hole) order.reverse()
  order.forEach((index, n) => {
    if (n === 0) path.moveTo(points[2 * index]!, points[2 * index + 1]!)
    else path.lineTo(points[2 * index]!, points[2 * index + 1]!)
  })
  path.closePath()
}

/** Adds a circle to `path`: clockwise for a shape, anticlockwise for a hole in one. */
function circle(path: Path2D, x: number, y: number, radius: number, hole = false): void {
  path.moveTo(x + radius, y)
  path.arc(x, y, radius, 0, Math.PI * 2, hole)
  path.closePath()
}

/** `path`, turned by `degrees` clockwise round the origin. */
function turned(path: Path2D, degrees: number): Path2D {
  const result = new Path2D()
  result.addPath(path, new DOMMatrix().rotate(degrees))
  return result
}

/** Builds a mark from what `draw` adds to a path, a line if it has a `width`. */
function mark(draw: (path: Path2D) => void, width?: number, degrees = 0): Mark {
  const path = new Path2D()
  draw(path)
  const shown = degrees === 0 ? path : turned(path, degrees)
  return width === undefined ? { path: shown } : { path: shown, width }
}

/** The marks of each icon, which the first icon drawn builds. */
let icons: Record<Icon, readonly Mark[]> | undefined

function build(): Record<Icon, readonly Mark[]> {
  return {
    anchor: [
      mark((p) => {
        circle(p, 0, -5.4, 2.1)
        circle(p, 0, -5.4, 1, true)
        p.roundRect(-0.95, -3.6, 1.9, 10.4, 0.6)
        p.roundRect(-3.8, -2.6, 7.6, 1.7, 0.85)
        polygon(p, [-7.4, 1.2, -4.2, 1.2, -5.8, 3.6])
        polygon(p, [7.4, 1.2, 4.2, 1.2, 5.8, 3.6])
      }),
      mark((p) => {
        p.moveTo(-5.8, 2.4)
        p.quadraticCurveTo(-5, 6.6, 0, 6.7)
        p.quadraticCurveTo(5, 6.6, 5.8, 2.4)
      }, 1.7),
    ],
    anvil: [
      mark((p) =>
        polygon(
          p,
          [
            -6.4, -4.4, 4.2, -4.4, 7.8, -3.4, 4.6, -1.4, 2.6, -1.4, 2.6, 1.6, 4.8, 4.4, 4.8, 6.2,
            -4.8, 6.2, -4.8, 4.4, -2.6, 1.6, -2.6, -1.4, -6.4, -1.4,
          ],
        ),
      ),
    ],
    badge: [
      mark((p) => {
        const points: number[] = []
        for (let i = 0; i < 10; i++) {
          const angle = (i * Math.PI) / 5 - Math.PI / 2
          const radius = i % 2 === 0 ? 7.8 : 3.4
          points.push(Math.cos(angle) * radius, Math.sin(angle) * radius + 0.6)
        }
        polygon(p, points)
      }),
    ],
    basket: [
      mark((p) => {
        p.roundRect(-7.8, -2.4, 15.6, 2.4, 1)
        polygon(p, [-6.8, -0.4, 6.8, -0.4, 5.2, 6.6, -5.2, 6.6])
        for (const x of [-3.7, -0.75, 2.2])
          polygon(p, [x, 1.2, x + 1.5, 1.2, x + 1.5, 5, x, 5], true)
      }),
      mark((p) => {
        p.moveTo(-4.6, -2.4)
        p.arc(0, -2.4, 4.6, Math.PI, Math.PI * 2)
      }, 1.6),
    ],
    boat: [
      mark((p) => {
        polygon(p, [-7.6, 2, 7.6, 2, 5, 6.6, -5, 6.6])
        polygon(p, [0.6, -7.6, 6, 0.8, 0.6, 0.8])
        polygon(p, [-0.6, -5.6, -0.6, 0.8, -5, 0.8])
      }),
    ],
    bottle: [
      mark((p) => {
        p.roundRect(-1.9, -7.8, 3.8, 1.6, 0.6)
        p.roundRect(-1.35, -6.6, 2.7, 3, 0.4)
        polygon(p, [-1.35, -4, 1.35, -4, 3.7, -1.4, -3.7, -1.4])
        p.roundRect(-3.7, -2.4, 7.4, 10.2, 1.8)
        polygon(p, [-2.3, 0.6, 2.3, 0.6, 2.3, 4.2, -2.3, 4.2], true)
      }),
    ],
    car: [
      mark((p) => {
        p.roundRect(-7.6, -1.6, 15.2, 5, 1.8)
        polygon(p, [-4.8, -1.6, -2.9, -5.8, 3.1, -5.8, 5.2, -1.6])
        polygon(p, [-2.9, -2.4, -0.4, -2.4, -0.4, -4.8, -2.1, -4.8], true)
        polygon(p, [0.5, -2.4, 3.6, -2.4, 2.6, -4.8, 0.5, -4.8], true)
        circle(p, -4.2, 3.6, 2.2)
        circle(p, 4.2, 3.6, 2.2)
      }),
    ],
    cross: [
      mark((p) => {
        p.roundRect(-2.7, -7.4, 5.4, 14.8, 1)
        p.roundRect(-7.4, -2.7, 14.8, 5.4, 1)
      }),
    ],
    cutlery: [
      mark((p) => {
        p.roundRect(-5.6, -3.4, 5, 2.6, 1.3)
        polygon(p, [2, -7.6, 4.9, -4.8, 4.9, 0.6, 2, 0.6])
      }),
      mark((p) => {
        p.moveTo(-3.1, -1.4)
        p.lineTo(-3.1, 7)
        p.moveTo(3.4, 0.6)
        p.lineTo(3.4, 7)
      }, 1.9),
      mark((p) => {
        for (const x of [-5, -3.1, -1.2]) {
          p.moveTo(x, -7.4)
          p.lineTo(x, -2.6)
        }
      }, 1.1),
    ],
    dollar: [
      mark((p) => {
        p.moveTo(0, -7.6)
        p.lineTo(0, 7.6)
      }, 1.6),
      mark((p) => {
        p.moveTo(4.3, -3.9)
        p.bezierCurveTo(3.3, -6.3, -4.6, -6.3, -4.4, -2.6)
        p.bezierCurveTo(-4.2, 0.2, 4.4, -0.4, 4.4, 2.8)
        p.bezierCurveTo(4.4, 6.5, -3.6, 6.5, -4.6, 3.8)
      }, 2.3),
    ],
    flag: [
      mark((p) => {
        p.roundRect(-5.4, -7.8, 1.9, 15.6, 0.9)
        p.moveTo(-3.8, -7.4)
        p.quadraticCurveTo(0.8, -9.4, 6.8, -6)
        p.quadraticCurveTo(0.8, -2.4, -3.8, -1.2)
        p.closePath()
      }),
    ],
    fuel: [
      mark((p) => {
        p.roundRect(-6.6, -7, 8.6, 14.4, 1.6)
        polygon(p, [-5, -5.4, 0.4, -5.4, 0.4, -1.6, -5, -1.6], true)
        p.roundRect(-7.6, 5.6, 10.6, 1.8, 0.6)
      }),
      mark((p) => {
        p.moveTo(2, -3.4)
        p.lineTo(4.6, -3.4)
        p.lineTo(5.8, -1.8)
        p.lineTo(5.8, 4.2)
        p.quadraticCurveTo(5.8, 5.4, 4.6, 5.2)
      }, 1.5),
    ],
    gun: [
      mark((p) =>
        polygon(
          p,
          [
            -7.4, -4.6, 7, -4.6, 7, -1.4, -0.4, -1.4, -1.1, 1.8, -2.7, 1.8, -3.6, 6.6, -7.2, 6.6,
            -5.7, -1.4, -7.4, -1.4,
          ],
        ),
      ),
      mark((p) => {
        p.moveTo(-0.4, -1.4)
        p.quadraticCurveTo(0.6, 2.4, -2.4, 2)
      }, 1.1),
    ],
    heart: [
      mark((p) => {
        circle(p, -3.2, -2.4, 3.8)
        circle(p, 3.2, -2.4, 3.8)
        polygon(p, [-6.8, -1, 6.8, -1, 0, 7])
      }),
    ],
    house: [
      mark((p) =>
        polygon(
          p,
          [
            0, -7.8, 7.8, -0.4, 5.2, -0.4, 5.2, 7.2, 1.6, 7.2, 1.6, 2.6, -1.6, 2.6, -1.6, 7.2, -5.2,
            7.2, -5.2, -0.4, -7.8, -0.4,
          ],
        ),
      ),
    ],
    lock: [
      mark((p) => {
        p.moveTo(-3.7, -0.6)
        p.lineTo(-3.7, -3.6)
        p.arc(0, -3.6, 3.7, Math.PI, Math.PI * 2)
        p.lineTo(3.7, -0.6)
      }, 2),
      mark((p) => {
        p.roundRect(-6.2, -1.8, 12.4, 9.4, 1.8)
        // The keyhole, cut out of the lock.
        const side = Math.sqrt(1.5 ** 2 - 0.6 ** 2)
        p.moveTo(0.6, 1.8 + side)
        p.arc(0, 1.8, 1.5, Math.atan2(side, 0.6), Math.atan2(side, -0.6), true)
        p.lineTo(-1, 5.2)
        p.lineTo(1, 5.2)
        p.closePath()
      }),
    ],
    parking: [
      mark((p) => {
        p.roundRect(-7.2, -7.2, 14.4, 14.4, 3)
        // The P, cut out of the sign, with the hole of its bowl.
        p.moveTo(-2.9, 4.9)
        p.lineTo(-0.8, 4.9)
        p.lineTo(-0.8, 1.1)
        p.lineTo(0.8, 1.1)
        p.arc(0.8, -1.9, 3, Math.PI / 2, -Math.PI / 2, true)
        p.lineTo(-2.9, -4.9)
        p.closePath()
        p.moveTo(-0.8, -3)
        p.lineTo(0.7, -3)
        p.arc(0.7, -1.9, 1.1, -Math.PI / 2, Math.PI / 2)
        p.lineTo(-0.8, -0.8)
        p.closePath()
      }),
    ],
    pill: [
      mark(
        (p) => {
          p.roundRect(-3.1, -7.6, 6.2, 15.2, 3.1)
          polygon(p, [-3.1, -0.45, 3.1, -0.45, 3.1, 0.45, -3.1, 0.45], true)
        },
        undefined,
        45,
      ),
    ],
    plane: [
      mark((p) => {
        p.moveTo(0, -8)
        p.quadraticCurveTo(1.6, -7, 1.6, -3)
        p.lineTo(8, 1)
        p.lineTo(8, 2.6)
        p.lineTo(1.6, 0.6)
        p.lineTo(1.1, 5)
        p.lineTo(3.6, 7)
        p.lineTo(3.6, 8)
        p.lineTo(0, 7)
        p.lineTo(-3.6, 8)
        p.lineTo(-3.6, 7)
        p.lineTo(-1.1, 5)
        p.lineTo(-1.6, 0.6)
        p.lineTo(-8, 2.6)
        p.lineTo(-8, 1)
        p.lineTo(-1.6, -3)
        p.quadraticCurveTo(-1.6, -7, 0, -8)
        p.closePath()
      }),
    ],
    scissors: [
      mark((p) => {
        for (const x of [-3.5, 3.5]) {
          circle(p, x, 4.3, 2.8)
          circle(p, x, 4.3, 1.35, true)
        }
        polygon(p, [-2.9, 2, -1.3, 2.5, 3.9, -7.4, 2.5, -7.8])
        polygon(p, [2.9, 2, 1.3, 2.5, -3.9, -7.4, -2.5, -7.8])
      }),
    ],
    shirt: [
      mark((p) => {
        p.moveTo(-3, -7.2)
        p.lineTo(-7.8, -4.6)
        p.lineTo(-5.8, -0.4)
        p.lineTo(-4.2, -1.4)
        p.lineTo(-4.2, 7.2)
        p.lineTo(4.2, 7.2)
        p.lineTo(4.2, -1.4)
        p.lineTo(5.8, -0.4)
        p.lineTo(7.8, -4.6)
        p.lineTo(3, -7.2)
        p.quadraticCurveTo(0, -4.2, -3, -7.2)
        p.closePath()
      }),
    ],
    spray: [
      mark((p) => {
        p.roundRect(-4.6, -3.2, 7.2, 11, 1.6)
        polygon(p, [-3.4, 0, 1.4, 0, 1.4, 3.4, -3.4, 3.4], true)
        p.roundRect(-3.2, -5.8, 4.4, 2.8, 0.8)
        p.roundRect(-1.8, -7.4, 1.6, 1.8, 0.4)
        circle(p, 2.6, -6.6, 0.9)
        circle(p, 4.6, -7.4, 0.8)
        circle(p, 4.8, -5.2, 0.9)
        circle(p, 6.8, -6.2, 0.8)
      }),
    ],
    syringe: [
      mark(
        (p) => {
          p.roundRect(-2.7, -4.2, 5.4, 8.2, 0.9)
          polygon(p, [-1.2, -2.8, 1.2, -2.8, 1.2, 2.6, -1.2, 2.6], true)
          p.roundRect(-3.4, 3.4, 6.8, 1.3, 0.5)
          p.roundRect(-0.7, 4.6, 1.4, 2.2, 0.3)
          p.roundRect(-2.6, 6.6, 5.2, 1.3, 0.5)
          p.roundRect(-1, -5.4, 2, 1.4, 0.4)
          polygon(p, [-0.55, -5.2, 0.55, -5.2, 0, -8.4])
        },
        undefined,
        45,
      ),
    ],
    wrench: [
      mark(
        (p) => {
          p.roundRect(-1.4, -1.4, 2.8, 9.4, 1.4)
          // The head, open at the top.
          const side = Math.sqrt(3.7 ** 2 - 1.25 ** 2)
          p.moveTo(1.25, -4.2 - side)
          p.arc(0, -4.2, 3.7, Math.atan2(-side, 1.25), Math.atan2(-side, -1.25) + Math.PI * 2)
          p.lineTo(-1.25, -3.5)
          p.lineTo(1.25, -3.5)
          p.closePath()
        },
        undefined,
        45,
      ),
    ],
  }
}

/**
 * Draws an icon `size` pixels wide, filled with the fill colour of the
 * context, and outlined `outline` pixels wide with its stroke colour.
 */
export function drawIcon(
  context: CanvasRenderingContext2D,
  icon: Icon,
  size: number,
  outline = 0,
): void {
  icons ??= build()
  const marks = icons[icon]
  const u = size / 16
  const fill = context.fillStyle
  context.save()
  context.scale(u, u)
  context.lineJoin = 'round'
  context.lineCap = 'round'
  if (outline > 0) {
    for (const { path, width } of marks) {
      context.lineWidth = (width ?? 0) + (outline * 2) / u
      context.stroke(path)
    }
  }
  context.strokeStyle = fill
  for (const { path, width } of marks) {
    if (width === undefined) context.fill(path)
    else {
      context.lineWidth = width
      context.stroke(path)
    }
  }
  context.restore()
}

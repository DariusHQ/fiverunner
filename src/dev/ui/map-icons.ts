/**
 * The icons that the styles of the map draw blips with, by what the sprites
 * of the blips stand for: FiveRunner's own drawings, in a square of `size`
 * pixels centred on the origin, filled with the colour of the context.
 */
export type Icon =
  | 'car'
  | 'bag'
  | 'shirt'
  | 'scissors'
  | 'gun'
  | 'dollar'
  | 'cross'
  | 'badge'
  | 'fuel'
  | 'house'
  | 'wrench'
  | 'plane'
  | 'flag'

/** What the sprites of blips that FiveRunner knows of stand for. */
const SPRITES: ReadonlyMap<number, Icon> = new Map([
  [8, 'flag'],
  [40, 'house'],
  [50, 'car'],
  [52, 'bag'],
  [60, 'badge'],
  [61, 'cross'],
  [71, 'scissors'],
  [72, 'wrench'],
  [73, 'shirt'],
  [108, 'dollar'],
  [110, 'gun'],
  [225, 'car'],
  [326, 'car'],
  [357, 'car'],
  [359, 'plane'],
  [360, 'plane'],
  [361, 'fuel'],
])

/** The icon of the sprite of a blip, if FiveRunner knows what it stands for. */
export function iconOf(sprite: number): Icon | undefined {
  return SPRITES.get(sprite)
}

/** Draws an icon, filled with the fill colour of the context and stroked with its stroke colour, if `stroke`. */
export function drawIcon(
  context: CanvasRenderingContext2D,
  icon: Icon,
  size: number,
  stroke = false,
): void {
  const u = size / 16
  context.save()
  context.scale(u, u)
  context.lineJoin = 'round'
  context.lineCap = 'round'
  const path = new Path2D()
  switch (icon) {
    case 'car':
      path.roundRect(-7, -2, 14, 6, 2)
      path.moveTo(-4.5, -2)
      path.lineTo(-3, -6)
      path.lineTo(3, -6)
      path.lineTo(4.5, -2)
      path.closePath()
      path.moveTo(-3, 6)
      path.arc(-4, 5, 1.8, 0, Math.PI * 2)
      path.moveTo(5.8, 5)
      path.arc(4, 5, 1.8, 0, Math.PI * 2)
      break
    case 'bag':
      path.roundRect(-6, -3, 12, 10, 1.5)
      path.moveTo(-3, -3)
      path.arc(0, -3, 3, Math.PI, 0)
      path.lineTo(2, -3)
      path.arc(0, -3, 2, 0, Math.PI, true)
      path.closePath()
      break
    case 'shirt':
      path.moveTo(-3, -7)
      path.lineTo(-7.5, -4.5)
      path.lineTo(-5.5, -0.5)
      path.lineTo(-4, -1.5)
      path.lineTo(-4, 7)
      path.lineTo(4, 7)
      path.lineTo(4, -1.5)
      path.lineTo(5.5, -0.5)
      path.lineTo(7.5, -4.5)
      path.lineTo(3, -7)
      path.quadraticCurveTo(0, -4, -3, -7)
      path.closePath()
      break
    case 'scissors':
      path.arc(-3.5, 4, 2.5, 0, Math.PI * 2)
      path.moveTo(6, 4)
      path.arc(3.5, 4, 2.5, 0, Math.PI * 2)
      path.moveTo(-2, 2)
      path.lineTo(3.5, -7)
      path.lineTo(4.5, -6)
      path.lineTo(0, 2.5)
      path.closePath()
      path.moveTo(2, 2)
      path.lineTo(-3.5, -7)
      path.lineTo(-4.5, -6)
      path.lineTo(0, 2.5)
      path.closePath()
      break
    case 'gun':
      path.moveTo(-7, -4)
      path.lineTo(7, -4)
      path.lineTo(7, -1)
      path.lineTo(-1, -1)
      path.lineTo(-1.5, 2)
      path.lineTo(-3, 2)
      path.lineTo(-4, 6)
      path.lineTo(-7, 6)
      path.lineTo(-5.5, -1)
      path.lineTo(-7, -1)
      path.closePath()
      break
    case 'dollar':
      path.roundRect(-1, -8, 2, 16, 1)
      path.moveTo(5, -4)
      path.bezierCurveTo(4, -7, -6, -7, -5.5, -2.5)
      path.bezierCurveTo(-5, 1.5, 5.5, -0.5, 5.5, 3)
      path.bezierCurveTo(5.5, 7, -4, 7, -5.5, 3.5)
      path.lineTo(-3.5, 2.5)
      path.bezierCurveTo(-2.5, 5, 3.5, 5, 3.5, 3)
      path.bezierCurveTo(3.5, 1, -7, 3, -7.5, -2.5)
      path.bezierCurveTo(-7.5, -8.5, 6, -8.5, 7, -5)
      path.closePath()
      break
    case 'cross':
      path.moveTo(-2.5, -7)
      path.lineTo(2.5, -7)
      path.lineTo(2.5, -2.5)
      path.lineTo(7, -2.5)
      path.lineTo(7, 2.5)
      path.lineTo(2.5, 2.5)
      path.lineTo(2.5, 7)
      path.lineTo(-2.5, 7)
      path.lineTo(-2.5, 2.5)
      path.lineTo(-7, 2.5)
      path.lineTo(-7, -2.5)
      path.lineTo(-2.5, -2.5)
      path.closePath()
      break
    case 'badge':
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2
        const radius = i % 2 === 0 ? 7.5 : 3.5
        const [x, y] = [Math.cos(angle) * radius, Math.sin(angle) * radius]
        if (i === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
      }
      path.closePath()
      break
    case 'fuel':
      path.roundRect(-6, -6, 8, 13, 1.5)
      path.moveTo(2, -3)
      path.lineTo(5, -3)
      path.lineTo(6, -1)
      path.lineTo(6, 5)
      path.lineTo(4.5, 5)
      path.lineTo(4.5, -0.5)
      path.lineTo(2, -1)
      path.closePath()
      break
    case 'house':
      path.moveTo(0, -7.5)
      path.lineTo(7.5, -0.5)
      path.lineTo(5, -0.5)
      path.lineTo(5, 7)
      path.lineTo(1.5, 7)
      path.lineTo(1.5, 2.5)
      path.lineTo(-1.5, 2.5)
      path.lineTo(-1.5, 7)
      path.lineTo(-5, 7)
      path.lineTo(-5, -0.5)
      path.lineTo(-7.5, -0.5)
      path.closePath()
      break
    case 'wrench':
      path.moveTo(-6.5, 5)
      path.lineTo(0.5, -2)
      path.arc(3, -4.5, 3.5, (3 * Math.PI) / 4, Math.PI / 4)
      path.lineTo(3, -5)
      path.lineTo(4.5, -8)
      path.arc(3, -4.5, 3.5, -Math.PI / 4, (5 * Math.PI) / 4, true)
      path.lineTo(2, -2)
      path.lineTo(-5, 6.5)
      path.closePath()
      break
    case 'plane':
      path.moveTo(0, -8)
      path.quadraticCurveTo(1.5, -7, 1.5, -3)
      path.lineTo(8, 1)
      path.lineTo(8, 2.5)
      path.lineTo(1.5, 0.5)
      path.lineTo(1, 5)
      path.lineTo(3.5, 7)
      path.lineTo(3.5, 8)
      path.lineTo(0, 7)
      path.lineTo(-3.5, 8)
      path.lineTo(-3.5, 7)
      path.lineTo(-1, 5)
      path.lineTo(-1.5, 0.5)
      path.lineTo(-8, 2.5)
      path.lineTo(-8, 1)
      path.lineTo(-1.5, -3)
      path.quadraticCurveTo(-1.5, -7, 0, -8)
      break
    case 'flag':
      path.roundRect(-5, -8, 1.8, 16, 0.9)
      path.moveTo(-3.5, -8)
      path.quadraticCurveTo(1, -9.5, 7, -6)
      path.quadraticCurveTo(1, -3, -3.5, -1.5)
      path.closePath()
      break
  }
  if (stroke) {
    context.lineWidth = 3 / u
    context.stroke(path)
  }
  context.fill(path, 'evenodd')
  context.restore()
}

import {
  defineNative,
  type NativeDefinition,
  type ParamSpec,
  type Side,
} from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { DEFAULT_FOV, type Camera, type Cameras } from '../world/cameras.ts'
import { fromEuler, toEuler } from '../world/rotation.ts'

/** The cameras of the client whose script calls a native. */
function camerasOf(ctx: NativeContext): Cameras {
  return ctx.manager.world!.cameras
}

/** The camera of a handle, if there is one. */
function cameraOf(ctx: NativeContext, handle: number): Camera | undefined {
  return camerasOf(ctx).get(handle)
}

/** Where the camera that renders is, and how it turns, as a vector of x, y and z: that of scripts, or the gameplay camera, which looks the way the ped of the player faces. */
function rendered(ctx: NativeContext, order: number) {
  const world = ctx.manager.world!
  const camera = world.cameras.rendered
  if (camera !== undefined) {
    const [x, y, z] = toEuler(camera.rotation, order)
    return { coords: { x: camera.x, y: camera.y, z: camera.z }, rotation: { x, y, z } }
  }
  const ped = world.playerPed
  const [x, y, z] = toEuler(ped.rotation, order)
  return { coords: { x: ped.x, y: ped.y, z: ped.z }, rotation: { x, y, z } }
}

/** Natives of the cameras of clients, which render nothing, as there is no game to render. */
export function cameraNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** A native of cameras that does nothing, as what it does is only drawn. */
  const nothing = (name: string, hash: bigint, params: readonly ParamSpec[]) =>
    defineNative({ name, hash, result: 'void', params }, () => {})
  /** Natives that create cameras, by names or by hashes of names, at the origin or at positions they are given. */
  const create = (
    name: string,
    hash: bigint,
    withParams: boolean,
    type: 'char* camName' | 'Hash camHash',
  ) =>
    withParams
      ? defineNative(
          {
            name,
            hash,
            result: 'Cam',
            params: [
              type,
              'float posX',
              'float posY',
              'float posZ',
              'float rotX',
              'float rotY',
              'float rotZ',
              'float fov',
              'BOOL active',
              'int rotationOrder',
            ],
          },
          (ctx: NativeContext, _type, x, y, z, rotX, rotY, rotZ, fov, active, order) => {
            const cameras = camerasOf(ctx)
            const handle = cameras.create(
              ctx.resource.name,
              x,
              y,
              z,
              fromEuler(rotX, rotY, rotZ, order),
              fov,
            )
            cameras.activate(cameras.get(handle)!, active)
            return handle
          },
        )
      : defineNative(
          { name, hash, result: 'Cam', params: [type, 'BOOL active'] },
          (ctx: NativeContext, _type, active) => {
            const cameras = camerasOf(ctx)
            const handle = cameras.create(ctx.resource.name, 0, 0, 0)
            cameras.activate(cameras.get(handle)!, active)
            return handle
          },
        )
  return [
    create('CREATE_CAM', 0xc3981dce61d9e13fn, false, 'char* camName'),
    create('CREATE_CAM_WITH_PARAMS', 0xb51194800b257161n, true, 'char* camName'),
    create('CREATE_CAMERA', 0x5e3cf89c6bcca67dn, false, 'Hash camHash'),
    create('CREATE_CAMERA_WITH_PARAMS', 0x6abfa3e16460f22dn, true, 'Hash camHash'),
    defineNative(
      {
        name: 'DESTROY_CAM',
        hash: 0x865908c81a2c22e9n,
        result: 'void',
        params: ['Cam cam', 'BOOL bScriptHostCam'],
      },
      (ctx: NativeContext, cam) => {
        const camera = cameraOf(ctx, cam)
        if (camera !== undefined) camerasOf(ctx).destroy(camera)
      },
    ),
    defineNative(
      {
        name: 'DESTROY_ALL_CAMS',
        hash: 0x8e5fb15663f79120n,
        result: 'void',
        params: ['BOOL bScriptHostCam'],
      },
      (ctx: NativeContext) => camerasOf(ctx).release(ctx.resource.name),
    ),
    defineNative(
      { name: 'DOES_CAM_EXIST', hash: 0xa7a932170592b50en, result: 'BOOL', params: ['Cam cam'] },
      (ctx: NativeContext, cam) => cameraOf(ctx, cam) !== undefined,
    ),
    defineNative(
      {
        name: 'SET_CAM_ACTIVE',
        hash: 0x026fb97d0a425f84n,
        result: 'void',
        params: ['Cam cam', 'BOOL active'],
      },
      (ctx: NativeContext, cam, active) => {
        const camera = cameraOf(ctx, cam)
        if (camera !== undefined) camerasOf(ctx).activate(camera, active)
      },
    ),
    defineNative(
      { name: 'IS_CAM_ACTIVE', hash: 0xdfb2b516207d3534n, result: 'BOOL', params: ['Cam cam'] },
      (ctx: NativeContext, cam) => {
        const camera = cameraOf(ctx, cam)
        return camera !== undefined && camerasOf(ctx).isActive(camera)
      },
    ),
    // Cameras move to where they go at once, so none is moving.
    defineNative(
      {
        name: 'SET_CAM_ACTIVE_WITH_INTERP',
        hash: 0x9fbda379383a52a4n,
        result: 'void',
        params: [
          'Cam camTo',
          'Cam camFrom',
          'int duration',
          'int easeLocation',
          'int easeRotation',
        ],
      },
      (ctx: NativeContext, to, from) => {
        const cameras = camerasOf(ctx)
        const camera = cameraOf(ctx, from)
        if (camera !== undefined) cameras.activate(camera, false)
        const next = cameraOf(ctx, to)
        if (next !== undefined) cameras.activate(next, true)
      },
    ),
    defineNative(
      {
        name: 'IS_CAM_INTERPOLATING',
        hash: 0x036f97c908c2b52cn,
        result: 'BOOL',
        params: ['Cam cam'],
      },
      () => false,
    ),
    defineNative(
      {
        name: 'RENDER_SCRIPT_CAMS',
        hash: 0x07e5b515db0636fcn,
        result: 'void',
        params: ['BOOL render', 'BOOL ease', 'int easeTime'],
      },
      (ctx: NativeContext, render) => {
        camerasOf(ctx).rendering = render
      },
    ),
    defineNative(
      { name: 'IS_CAM_RENDERING', hash: 0x02ec0af5c5a49b7an, result: 'BOOL', params: ['Cam cam'] },
      (ctx: NativeContext, cam) => {
        const camera = cameraOf(ctx, cam)
        return camera !== undefined && camerasOf(ctx).rendered === camera
      },
    ),
    // The gameplay camera renders when no camera of scripts does, which GTA V names -1.
    defineNative(
      { name: 'GET_RENDERING_CAM', hash: 0x5234f9f10919eaban, result: 'Cam', params: [] },
      (ctx: NativeContext) => camerasOf(ctx).rendered?.handle ?? -1,
    ),
    defineNative(
      {
        name: 'SET_CAM_COORD',
        hash: 0x4d41783fb745e42en,
        result: 'void',
        params: ['Cam cam', 'float posX', 'float posY', 'float posZ'],
      },
      (ctx: NativeContext, cam, x, y, z) => {
        const camera = cameraOf(ctx, cam)
        if (camera !== undefined) Object.assign(camera, { x, y, z })
      },
    ),
    defineNative(
      { name: 'GET_CAM_COORD', hash: 0xbac038f7459ae5aen, result: 'Vector3', params: ['Cam cam'] },
      (ctx: NativeContext, cam) => {
        const camera = cameraOf(ctx, cam)
        return { x: camera?.x ?? 0, y: camera?.y ?? 0, z: camera?.z ?? 0 }
      },
    ),
    defineNative(
      {
        name: 'SET_CAM_ROT',
        hash: 0x85973643155d0b07n,
        result: 'void',
        params: ['Cam cam', 'float rotX', 'float rotY', 'float rotZ', 'int rotationOrder'],
      },
      (ctx: NativeContext, cam, x, y, z, order) => {
        const camera = cameraOf(ctx, cam)
        if (camera !== undefined) camera.rotation = fromEuler(x, y, z, order)
      },
    ),
    defineNative(
      {
        name: 'GET_CAM_ROT',
        hash: 0x7d304c1c955e3e12n,
        result: 'Vector3',
        params: ['Cam cam', 'int rotationOrder'],
      },
      (ctx: NativeContext, cam, order) => {
        const camera = cameraOf(ctx, cam)
        if (camera === undefined) return { x: 0, y: 0, z: 0 }
        const [x, y, z] = toEuler(camera.rotation, order)
        return { x, y, z }
      },
    ),
    defineNative(
      {
        name: 'SET_CAM_FOV',
        hash: 0xb13c14f66a00d047n,
        result: 'void',
        params: ['Cam cam', 'float fieldOfView'],
      },
      (ctx: NativeContext, cam, fov) => {
        const camera = cameraOf(ctx, cam)
        if (camera !== undefined) camera.fov = fov
      },
    ),
    defineNative(
      { name: 'GET_CAM_FOV', hash: 0xc3330a45cccdb26an, result: 'float', params: ['Cam cam'] },
      (ctx: NativeContext, cam) => cameraOf(ctx, cam)?.fov ?? 0,
    ),
    defineNative(
      {
        name: 'SET_CAM_PARAMS',
        hash: 0xbfd8727aea3cceban,
        result: 'void',
        params: [
          'Cam cam',
          'float posX',
          'float posY',
          'float posZ',
          'float rotX',
          'float rotY',
          'float rotZ',
          'float fieldOfView',
          'Any p8',
          'int p9',
          'int p10',
          'int rotationOrder',
        ],
      },
      (ctx: NativeContext, cam, x, y, z, rotX, rotY, rotZ, fov, _p8, _p9, _p10, order) => {
        const camera = cameraOf(ctx, cam)
        if (camera !== undefined) {
          Object.assign(camera, { x, y, z, fov, rotation: fromEuler(rotX, rotY, rotZ, order) })
        }
      },
    ),
    defineNative(
      { name: 'GET_GAMEPLAY_CAM_COORD', hash: 0x14d6f5678d8f1b37n, result: 'Vector3', params: [] },
      (ctx: NativeContext) => {
        const { x, y, z } = ctx.manager.world!.playerPed
        return { x, y, z }
      },
    ),
    defineNative(
      {
        name: 'GET_GAMEPLAY_CAM_ROT',
        hash: 0x837765a25378f0bbn,
        result: 'Vector3',
        params: ['int rotationOrder'],
      },
      (ctx: NativeContext, order) => {
        const [x, y, z] = toEuler(ctx.manager.world!.playerPed.rotation, order)
        return { x, y, z }
      },
    ),
    defineNative(
      { name: 'GET_GAMEPLAY_CAM_FOV', hash: 0x65019750a0324133n, result: 'float', params: [] },
      () => DEFAULT_FOV,
    ),
    defineNative(
      {
        name: 'GET_FINAL_RENDERED_CAM_COORD',
        hash: 0xa200eb1ee790f448n,
        result: 'Vector3',
        params: [],
      },
      (ctx: NativeContext) => rendered(ctx, 2).coords,
    ),
    defineNative(
      {
        name: 'GET_FINAL_RENDERED_CAM_ROT',
        hash: 0x5b4e4c817fcc2dfbn,
        result: 'Vector3',
        params: ['int rotationOrder'],
      },
      (ctx: NativeContext, order) => rendered(ctx, order).rotation,
    ),
    nothing('POINT_CAM_AT_COORD', 0xf75497bb865f0803n, [
      'Cam cam',
      'float x',
      'float y',
      'float z',
    ]),
    nothing('POINT_CAM_AT_ENTITY', 0x5640bff86b16e8dcn, ['Cam cam', 'Entity entity']),
    nothing('STOP_CAM_POINTING', 0xf33ab75780ba57den, ['Cam cam']),
    nothing('ATTACH_CAM_TO_ENTITY', 0xfedb7d269e8c60e3n, ['Cam cam', 'Entity entity']),
    nothing('DETACH_CAM', 0xa2fabbe87f4bad82n, ['Cam cam']),
    nothing('SET_CAM_DOF_STRENGTH', 0x5ee29b4d7d5df897n, ['Cam cam', 'float dofStrength']),
    nothing('SET_CAM_FAR_DOF', 0xedd91296cd01aee0n, ['Cam cam', 'float farDOF']),
    nothing('SET_CAM_NEAR_DOF', 0x3fa4bf0a7ab7de2cn, ['Cam cam', 'float nearDOF']),
    nothing('SET_CAM_USE_SHALLOW_DOF_MODE', 0x16a96863a17552bbn, ['Cam cam', 'BOOL toggle']),
    nothing('SHAKE_CAM', 0x6a25241c340d3822n, ['Cam cam', 'char* type', 'float amplitude']),
    nothing('STOP_CAM_SHAKING', 0xbdecf64367884ac3n, ['Cam cam', 'BOOL p1']),
  ]
}

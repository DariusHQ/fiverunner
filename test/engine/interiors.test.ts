import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('The interiors of clients', () => {
  it('are none of the map of GTA V, but have the entity sets that scripts activate', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`local interior = GetInteriorAtCoords(-1155.0, -1520.0, 10.6)
print(interior, GetInteriorAtCoords(0.0, 0.0, 0.0), GetInteriorFromEntity(PlayerPedId()), IsValidInterior(interior))
ActivateInteriorEntitySet(interior, 'set_style_01')
SetInteriorEntitySetColor(interior, 'set_style_01', 3)
ActivateInteriorEntitySet(interior, 'set_style_02')
DeactivateInteriorEntitySet(interior, 'set_style_02')
RefreshInterior(interior)
print(IsInteriorEntitySetActive(interior, 'SET_STYLE_01'), IsInteriorEntitySetActive(interior, 'set_style_02'), IsDlcPresent(GetHashKey('mpheist')))`),
    ).toEqual(['0\t0\t0\tfalse', '1\tfalse\t1'])
    expect(client.diagnostics).toEqual([
      'run0: GetInteriorAtCoords found no interior, as FiveRunner has no map of GTA V and knows none of its interiors.',
      'run0: GetInteriorFromEntity found no interior, as FiveRunner has no map of GTA V and knows none of its interiors.',
    ])
  })

  it('render to the targets that scripts register and link', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`local model = GetHashKey('prop_tv_flat_01')
print(IsNamedRendertargetRegistered('tvscreen'), GetNamedRendertargetRenderId('tvscreen'))
print(RegisterNamedRendertarget('tvscreen', false), RegisterNamedRendertarget('tvscreen', false), RegisterNamedRendertarget('other', false))
LinkNamedRendertarget(model)
print(IsNamedRendertargetRegistered('tvscreen'), GetNamedRendertargetRenderId('tvscreen'), GetNamedRendertargetRenderId('other'), IsNamedRendertargetLinked(model))
print(ReleaseNamedRendertarget('tvscreen'), IsNamedRendertargetRegistered('tvscreen'))`),
    ).toEqual(['false\t0', '1\tfalse\t1', '1\t1\t2\t1', '1\tfalse'])
    expect(client.diagnostics).toEqual([])
  })

  it('find the objects of scripts that are closest, which are the only ones', async () => {
    const test = await clientOf()
    test.run(`local chair = GetHashKey('prop_chair_01a')
RequestModel(chair)
CreateThread(function()
    while not HasModelLoaded(chair) do Wait(0) end
    local far = CreateObject(chair, 10.0, 0.0, 0.0, false, false, false)
    local near = CreateObject(chair, 2.0, 0.0, 0.0, false, false, false)
    print(GetClosestObjectOfType(0.0, 0.0, 0.0, 20.0, chair, false, false, false) == near, GetClosestObjectOfType(0.0, 0.0, 0.0, 1.0, chair, false, false, false), GetClosestObjectOfType(0.0, 0.0, 0.0, 20.0, GetHashKey('prop_bench_01a'), false, false, false))
end)`)
    test.client.tickAt(test.client.time + 10)
    expect(
      test.client
        .take()
        .filter((line) => line.startsWith('[script:run0] '))
        .map((line) => line.slice('[script:run0] '.length)),
    ).toEqual(['true\t0\t0'])
  })
})

import type { NativeDefinition, Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { blipNatives, textNatives } from './blips.ts'
import { consoleNatives } from './console.ts'
import { controlNatives } from './controls.ts'
import { convarNatives } from './convars.ts'
import { entityNatives } from './entities.ts'
import { eventNatives } from './events.ts'
import { gameNatives } from './game.ts'
import { httpNatives } from './http.ts'
import { kvpNatives } from './kvp.ts'
import { networkNatives } from './network.ts'
import { nuiNatives } from './nui.ts'
import { oxmysqlNatives } from './oxmysql.ts'
import { playerNatives } from './players.ts'
import { refNatives } from './refs.ts'
import { resourceNatives } from './resources.ts'
import { rpcNatives } from './rpc.ts'
import { screenNatives } from './screen.ts'
import { scriptingNatives } from './scripting.ts'
import { stateBagNatives } from './states.ts'
import { streamingNatives } from './streaming.ts'
import { vehicleNatives } from './vehicles.ts'
import { weatherNatives } from './weather.ts'

/** The natives FiveRunner implements for a side, which replace those of the catalog. */
export function engineNatives(side: Side): NativeDefinition<NativeContext>[] {
  return [
    ...scriptingNatives(side),
    ...eventNatives(),
    ...refNatives(),
    ...resourceNatives(side),
    ...consoleNatives(side),
    ...convarNatives(side),
    ...kvpNatives(side),
    ...networkNatives(side),
    ...playerNatives(side),
    ...stateBagNatives(side),
    ...entityNatives(side),
    ...vehicleNatives(side),
    ...rpcNatives(side),
    ...streamingNatives(side),
    ...screenNatives(side),
    ...blipNatives(side),
    ...textNatives(side),
    ...controlNatives(side),
    ...gameNatives(side),
    ...weatherNatives(side),
    ...(side === 'server' ? [...httpNatives(), ...oxmysqlNatives()] : nuiNatives()),
  ]
}

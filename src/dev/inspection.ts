import type { Resource, ResourceManager, ResourceState } from '../core/engine/index.ts'
import { describeValue } from './values.ts'

/** A process of a session: its server, or the number of a client. */
export type DevProcess = 'server' | number

/** What a resource of a process has, as the inspector shows it. */
export interface DevResource {
  readonly name: string
  readonly state: ResourceState
  /** The milliseconds that its scripts took so far, by the clock of the host. */
  readonly cpu: number
  readonly exports: readonly string[]
  /** The events that it handles, but those of its exports, of NUI and of FiveM's own. */
  readonly events: readonly string[]
  readonly nuiCallbacks: readonly string[]
  readonly commands: readonly string[]
  /** The keys that it bound commands to, on clients: the key, the command and its description. */
  readonly keyMappings: readonly string[]
  /** Its KVP, with the values as describe writes them. */
  readonly kvp: readonly { readonly key: string; readonly value: string }[]
}

/** What the inspector shows of a process. */
export interface DevInspection {
  readonly process: DevProcess
  /** The ticks that the process ran so far, which divide the time of its resources. */
  readonly ticks: number
  readonly resources: readonly DevResource[]
  readonly convars: readonly { readonly name: string; readonly value: string }[]
}

const INTERNAL_EVENT = '__cfx_'
const NUI_EVENT = '__cfx_nui:'

/** What `resource` of `manager` has, as DevResource says. */
function describeResource(manager: ResourceManager, resource: Resource): DevResource {
  const { name, state, cpuTime } = resource
  const events = [...resource.handledEvents].sort()
  const exportEvent = `${INTERNAL_EVENT}export_${name}_`
  const kvpKey = `res:${name}:`
  return {
    name,
    state,
    cpu: cpuTime,
    exports: events
      .filter((event) => event.startsWith(exportEvent))
      .map((event) => event.slice(exportEvent.length)),
    events: events.filter((event) => !event.startsWith(INTERNAL_EVENT)),
    nuiCallbacks: events
      .filter((event) => event.startsWith(NUI_EVENT))
      .map((event) => event.slice(NUI_EVENT.length)),
    commands: manager.console.commands.list
      .filter((command) => command.resource === name)
      .map((command) => command.name),
    keyMappings: Array.from(manager.world?.input.mappings.values() ?? [])
      .filter((mapping) => mapping.resource === name)
      .map(({ key, command, description }) => `${key}: ${command}, ${description}`),
    kvp: manager.kvp.keysWith(kvpKey).map((key) => ({
      key: key.slice(kvpKey.length),
      value: describeValue(manager.kvp.get(key)!),
    })),
  }
}

/** What the inspector shows of `manager`, the process `process` of a session. */
export function describeProcess(manager: ResourceManager, process: DevProcess): DevInspection {
  return {
    process,
    ticks: manager.ticks,
    resources: Array.from(manager.resources, (resource) =>
      describeResource(manager, resource),
    ).sort((a, b) => a.name.localeCompare(b.name)),
    convars: manager.console.variables
      .list()
      .map(({ name, variable }) => ({ name, value: variable.value })),
  }
}

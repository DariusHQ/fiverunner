import type { PackedValue } from '../core/engine/msgpack.ts'
import type { Answer, Ask } from './answers.ts'
import type { DevEvent, EventTarget } from './session.ts'

/** What the dev server tells the dev UI of its project. */
export interface ProjectInfo {
  /** The name of the directory of the project. */
  readonly name: string
  /** A resource, or a server with a resources directory. */
  readonly kind: 'resource' | 'server'
  /** Where servers have the files of the project: resources/ and the name of the resource, or their root. */
  readonly mount: string
  /** The commands that start the project, such as ensure and the name of a resource. */
  readonly commands: readonly string[]
}

/** What the dev UI asks of the worker that runs its engine. */
export type ToWorker =
  /** Starts a session of the project, or starts it anew with the players it had, if one runs. */
  | { readonly type: 'start' }
  | { readonly type: 'command'; readonly line: string }
  /** Files of the project changed, at these paths in it, or at paths that the dev server could not tell. */
  | { readonly type: 'change'; readonly paths: readonly string[] | null }
  | { readonly type: 'connect'; readonly name: string }
  | { readonly type: 'disconnect'; readonly client: number }
  | { readonly type: 'submitCard'; readonly client: number; readonly json: string }
  /** Triggers an event as the network does, to the server from a client, or to clients from the server. */
  | {
      readonly type: 'emit'
      readonly name: string
      readonly args: readonly PackedValue[]
      readonly target: EventTarget
    }
  /** Puts the ped of the player of a client at coordinates of the world, from the map. */
  | { readonly type: 'teleport'; readonly client: number; readonly x: number; readonly y: number }
  /** Sets the waypoint of the player of a client at coordinates of the world, from the map. */
  | { readonly type: 'waypoint'; readonly client: number; readonly x: number; readonly y: number }
  /** A key of the keyboard of a client went down or up, by the name of FiveM's keyboard mapper. */
  | { readonly type: 'key'; readonly client: number; readonly key: string; readonly down: boolean }
  /** Where the cursor is in the game window of a client, in pixels. */
  | { readonly type: 'cursor'; readonly client: number; readonly x: number; readonly y: number }
  /** What the service worker of the frames of a client at a host of FiveM's asks, which the worker answers by `id`. */
  | {
      readonly type: 'ask'
      readonly id: number
      readonly client: number
      readonly host: string
      readonly ask: Ask
    }

/** What the worker tells the dev UI. */
export type FromWorker =
  /** A session started, of a project, which the events that follow are of. */
  | { readonly type: 'started'; readonly project: ProjectInfo }
  /** A session failed to start. */
  | { readonly type: 'failed'; readonly message: string }
  /** The session restarted the resources that files changed in, or none, when it needs to start anew. */
  | { readonly type: 'changed'; readonly restarted: readonly string[] | null }
  | { readonly type: 'event'; readonly event: DevEvent }
  | { readonly type: 'answer'; readonly id: number; readonly answer: Answer }

/**
 * What the service worker of the frames of an origin and the bridge of the
 * origin say to each other: the worker asks, the bridge tells that it took
 * the request, then gives the answer of the client.
 */
export type BridgeMessage =
  | { readonly type: 'ask'; readonly id: number; readonly ask: Ask }
  | { readonly type: 'ack'; readonly id: number }
  | { readonly type: 'answer'; readonly id: number; readonly answer: Answer }

/** What a bridge and the dev UI say to each other. */
export type BridgeToUi =
  /** The bridge registered the service worker of its origin, which is ready for frames. */
  | { readonly type: 'fiverunner:bridge' }
  | { readonly type: 'fiverunner:ask'; readonly id: number; readonly ask: Ask }

export type UiToBridge = {
  readonly type: 'fiverunner:answer'
  readonly id: number
  readonly answer: Answer
}

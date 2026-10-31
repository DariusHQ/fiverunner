import type { AskingFrame } from '../dev/protocol.ts'

/**
 * Where a frame of the playground is, under the directory of the page,
 * which has one origin for all of them: frames/, the tab, the client, the
 * host of FiveM's, and the path of its page.
 */
export function framePath({ tab, client, host }: AskingFrame, path: string): string {
  return `frames/${tab}/${client}/${encodeURIComponent(host)}${path}`
}

/** The frame that a URL path is of, with the rest of the path, if it is under `base`, the directory of the page. */
export function parseFramePath(
  pathname: string,
  base: string,
): { readonly frame: AskingFrame; readonly path: string } | undefined {
  if (!pathname.startsWith(`${base}frames/`)) return undefined
  const match = /^([a-z0-9]+)\/([1-9][0-9]*)\/([^/]+)(\/.*)?$/.exec(
    pathname.slice(base.length + 'frames/'.length),
  )
  if (match === null) return undefined
  const [, tab = '', client = '', host = '', path = '/'] = match
  return { frame: { tab, client: Number(client), host: decodeURIComponent(host) }, path }
}

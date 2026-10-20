/**
 * The domain of the dev UI, which browsers take for the local machine, as
 * they do every name under localhost. Frames are at names under it, an
 * origin for each host of FiveM's that a client has frames at, so that
 * frames keep their storage to themselves and stay out of the UI, as in
 * FiveM, where each is at an origin of its own: https://cfx-nui-<resource>,
 * or nui://<resource>.
 */
export const DEV_DOMAIN = 'fiverunner.localhost'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** The frames of a client of a tab of the dev UI, at a host of FiveM's. */
export interface FrameHost {
  /** The host of FiveM's: cfx-nui-<resource>, or the resource for nui:// frames. */
  readonly host: string
  /** The number of the client. */
  readonly client: number
  /** The tab of the dev UI, by an id of letters and digits, which keeps its frames to itself. */
  readonly tab: string
}

/**
 * The name of the origin that the frames of a client of a tab are at: the
 * host of FiveM's, in lower case as browsers have hosts, c and the number
 * of the client, and the tab, under DEV_DOMAIN. Hosts with characters that
 * names may not have, such as spaces, go as their UTF-8 bytes in hex, then x.
 */
export function frameHost({ host, client, tab }: FrameHost): string {
  const lower = host.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
  const label = /^[a-z0-9_-]+$/.test(lower)
    ? lower
    : `${Array.from(encoder.encode(lower), (byte) => byte.toString(16).padStart(2, '0')).join('')}.x`
  return `${label}.c${client}.${tab}.${DEV_DOMAIN}`
}

/** What a name of frameHost stands for, or undefined for other names. */
export function parseFrameHost(name: string): FrameHost | undefined {
  const match = /^(.+)\.c([1-9][0-9]*)\.([a-z0-9]+)\.fiverunner\.localhost$/.exec(name)
  if (match === null) return undefined
  const [, label = '', number = '', tab = ''] = match
  const client = Number(number)
  if (/^[a-z0-9_-]+$/.test(label)) return { host: label, client, tab }
  const hex = /^((?:[0-9a-f]{2})+)\.x$/.exec(label)?.[1]
  if (hex === undefined) return undefined
  const bytes = Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))
  return { host: decoder.decode(bytes), client, tab }
}

/** The origin that FiveM's frames of a host are at: https://cfx-nui-<resource>, or nui://<resource>. */
export function fivemOrigin(host: string): string {
  return host.startsWith('cfx-nui-') ? `https://${host}` : `nui://${host}`
}

/**
 * Where the dev UI shows a frame of a client of a tab whose page is at
 * `url`, as FiveM gives frames their URLs: those of its own hosts at the
 * origin of frameHost, with `port`, and those of the web as they are.
 */
export function devFrameUrl(url: string, client: number, tab: string, port: string): string {
  const match = /^(?:nui:\/\/|https:\/\/(?=cfx-nui-))([^/?#]*)(.*)$/i.exec(url)
  if (match === null) return url
  const [, host = '', rest = ''] = match
  const path = rest.startsWith('/') ? rest : `/${rest}`
  return `http://${frameHost({ host, client, tab })}${port === '' ? '' : `:${port}`}${path}`
}

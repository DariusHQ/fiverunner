/** Where the dev server serves what the frames of the dev UI run on: its service worker, and the bridge to the UI. */
export const DEV_PATH = '/__fiverunner/'

/** What the service worker of a frame does with a request of its pages. */
export type Route =
  /** Answers it with a file of the host of the frame, at `path`. */
  | { readonly kind: 'file'; readonly path: string }
  /**
   * Asks the client for what FiveM's NUI gives a request of `url`: a file
   * of a resource at https://cfx-nui-<resource>, what callbacks answer at
   * http://<resource> and https://<resource>, or the web for other hosts.
   */
  | { readonly kind: 'ask'; readonly url: URL }
  /** Leaves it to the browser, which takes it to the dev server or the web. */
  | { readonly kind: 'network' }

/**
 * How the service worker of the frames at `origin`, a name of frameHost,
 * handles a request of their pages for `url`: those of the origin go to
 * the host of the frames, as their paths, but those of DEV_PATH, which
 * the dev server serves, and requests over HTTP to other hosts go to the
 * client to answer.
 */
export function route(url: URL, origin: string): Route {
  if (url.origin === origin) {
    return url.pathname.startsWith(DEV_PATH)
      ? { kind: 'network' }
      : { kind: 'file', path: url.pathname }
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return { kind: 'ask', url }
  return { kind: 'network' }
}

/**
 * The service worker of the playground, whose frames share the origin of
 * its page, as a static site has one: it answers the requests of their
 * pages as FiveM's NUI does, which it tells by the paths of the frames, and
 * leaves the rest to the site.
 */
import { DEV_PATH } from '../dev/routes.ts'
import { respond, scope, type FetchEvent } from '../dev/sw-shared.ts'
import { parseFramePath } from './paths.ts'

const { origin, pathname } = new URL('./', scope.location.href)

/** Answers what `event` asks of the site, or of its client if a page of a frame asks it. */
async function answer({ request, clientId }: FetchEvent): Promise<Response> {
  const page = clientId === '' ? undefined : await scope.clients.get(clientId)
  const found =
    page === undefined ? undefined : parseFramePath(new URL(page.url).pathname, pathname)
  if (found === undefined) return fetch(request)
  const url = new URL(request.url)
  if (url.origin !== origin) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fetch(request)
    return respond(request, request.clone(), undefined, found.frame)
  }
  // jQuery, at the path of the dev server, and the files of the host by their absolute paths.
  if (url.pathname.startsWith(DEV_PATH)) {
    return fetch(new URL(url.pathname.slice(DEV_PATH.length), origin + pathname))
  }
  return respond(request, request.clone(), { kind: 'file', path: url.pathname }, found.frame)
}

scope.addEventListener('install', (event) => event.waitUntil(scope.skipWaiting()))
scope.addEventListener('activate', (event) => event.waitUntil(scope.clients.claim()))
scope.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  const frame = url.origin === origin ? parseFramePath(url.pathname, pathname) : undefined
  if (frame === undefined) event.respondWith(answer(event))
  else {
    const ask = { kind: 'file', path: frame.path } as const
    event.respondWith(respond(request, request.clone(), ask, frame.frame))
  }
})

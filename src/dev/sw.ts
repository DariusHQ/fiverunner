/**
 * The service worker of the frames of an origin of the dev UI, which
 * answers the requests of their pages as FiveM's NUI does: it asks the
 * bridge of the origin, which asks the client of the frames, through the
 * dev UI.
 */
import type { Ask } from './answers.ts'
import { route } from './routes.ts'
import { respond, scope, type FetchEvent } from './sw-shared.ts'

scope.addEventListener('install', (event) => event.waitUntil(scope.skipWaiting()))
scope.addEventListener('activate', (event) => event.waitUntil(scope.clients.claim()))
scope.addEventListener('fetch', (event) => {
  const { request } = event
  const found = route(new URL(request.url), scope.location.origin)
  if (found.kind === 'network') return
  const ask: Ask | undefined =
    found.kind === 'file' ? { kind: 'file', path: found.path } : undefined
  event.respondWith(respond(request, request.clone(), ask))
})

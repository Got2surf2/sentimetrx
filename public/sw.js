// public/sw.js
// Minimal service worker — enough to satisfy iOS's installability check
// and unlock web-push notifications (iOS 16.4+) when we later wire push.
//
// Deliberately NO offline caching for v1: the status surface reads live
// counts from the API, so a stale cache would lie. Add a real caching
// strategy here when the UX includes views that survive offline.
//
// Scope is the whole origin (served from /sw.js). Registered from the /m
// route only, but once active it stays active for the whole origin until
// unregistered — that's fine, the rest of the app doesn't care.

self.addEventListener('install', function(event) {
  // skipWaiting so a new SW activates immediately instead of waiting for
  // every existing tab to close. For a personal-use PWA this is what you
  // want: the latest code lands the moment it deploys.
  self.skipWaiting()
})

self.addEventListener('activate', function(event) {
  // claim() takes control of currently-open pages so the new SW starts
  // serving them right away.
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', function(event) {
  // Network-first, no caching. Letting all requests fall through to the
  // network keeps the status surface honest. If we add offline screens
  // later, special-case those routes here.
  return
})

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
// unregistered — which is exactly why the v2 rules below matter for every
// page, not just the status surface.

self.addEventListener('install', function(event) {
  // skipWaiting so a new SW activates immediately instead of waiting for
  // every existing tab to close. Safe ONLY because this worker has no fetch
  // listener (see below) — activating over live tabs can't break their
  // in-flight requests when the worker never intercepts requests at all.
  self.skipWaiting()
})

self.addEventListener('activate', function(event) {
  // claim() takes control of currently-open pages so the new SW starts
  // serving them right away.
  event.waitUntil(self.clients.claim())
})

// NO fetch listener — deliberately (v2, 2026-07-13). The v1 no-op handler
// inserted this worker into EVERY request on the origin: each fetch had to
// wake the SW process, and skipWaiting+claim swapped workers over live tabs
// on every deploy — leaving sessions where soft navigations 200'd on the
// server but the response never reached React (owner: "Schema comes up once
// after a hard refresh, then never again" — a hard refresh is the one
// navigation that bypasses the SW, which is why it always cured it).
// A worker with no fetch listener is skipped by the browser entirely
// (no-fetch-handler optimization) while push + installability keep working —
// which is all this worker exists for. If offline caching ever lands here,
// it must ship with a versioned-cache strategy, not skipWaiting over live tabs.

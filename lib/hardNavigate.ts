// lib/hardNavigate.ts
//
// Full page load to an internal path — ON PURPOSE.
//
// `router.push()` keeps the current React tree, layouts and client caches
// alive. After a mutation that rebuilds what the destination shows (a dataset
// sync, a re-transcribe, a clone, a delete) we want none of that to survive:
// the next screen must come from a fresh server render. It is also how a
// navigation-style file download (`?export=csv`) is started.
//
// Use `useRouter().push()` for ordinary links. Reach for this only when the
// reload IS the point, and say why at the call site if it is not obvious.
// (eslint `@next/next/no-location-assign-relative-destination` flags inline
// `window.location.href = '/…'`; routing the deliberate cases through one named
// helper keeps the rule on for the accidental ones.)
export function hardNavigate(path: string): void {
  window.location.assign(path)
}

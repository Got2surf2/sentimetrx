// Preload shim: neutralize the `server-only` sentinel so one-off lib scripts
// can import server-side helpers. Use only when running scripts/_*.ts that
// need to call into lib/*.ts paths gated by `import 'server-only'`.
//
// Run via:
//   NODE_OPTIONS='--require ./scripts/_no_server_only.cjs' tsx scripts/foo.ts
const path = require('path')
const Module = require('module')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'server-only') {
    return path.join(__dirname, '_server_only_stub.cjs')
  }
  return origResolve.call(this, request, parent, ...rest)
}

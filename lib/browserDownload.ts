// lib/browserDownload.ts
//
// Fetch a generated file and hand it to the browser as a download.
//
// The point is COMPLETION. `window.location.href = url` / `window.open(url)`
// starts a navigation the page can never observe — no success, no failure, no
// "still working", which is why a 60-second deck build looked like a dead
// button. Fetching it instead means the promise settles when the last byte
// lands, so a caller can drive a real busy state and show a real error.
//
// What this deliberately does NOT do is report a percentage. These routes spend
// nearly all their wall-clock generating server-side before the first byte, so
// byte progress would sit at 0 and then jump to 100 — a progress bar that lies.
// Elapsed time is honest; a percentage would need a job record and polling.

export type DownloadRequest = {
  method?: 'GET' | 'POST'
  body?: unknown
  /** Used only when the response carries no Content-Disposition filename. */
  fallbackName?: string
}

const nameFromDisposition = (h: string | null): string | null => {
  if (!h) return null
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(h)
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * Resolves once the file has been handed to the browser. Throws on a non-2xx
 * response or a network failure, with the server's `error` message when it sent
 * one — callers surface it rather than guessing.
 */
export async function downloadFile(url: string, req: DownloadRequest = {}): Promise<void> {
  const method = req.method || 'GET'
  const res = await fetch(url, {
    method,
    ...(req.body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) }
      : {}),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const t = await res.text()
      const parsed: unknown = t ? JSON.parse(t) : null
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const e = (parsed as { error: unknown }).error
        if (typeof e === 'string') detail = e
      }
    } catch { /* non-JSON body — the status is all we have */ }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = nameFromDisposition(res.headers.get('content-disposition')) || req.fallbackName || 'download'
    a.click()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

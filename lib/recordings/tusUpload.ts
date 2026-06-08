// lib/recordings/tusUpload.ts
//
// Shared client-side TUS upload primitive for Town Hall media. Pushes a Blob/File
// straight to Supabase Storage's resumable endpoint with the user's session JWT.
// Used by the wizard's "Add recording" pane (AddRecordingClient) and the live
// capture client (LiveClient) so there is one upload code path, not two.
//
// This resolves on a successful *storage* upload only — callers do their own
// /files/[fileId]/uploaded ack afterward, since that's app state, not storage.

import * as tus from 'tus-js-client'

export interface TusUploadArgs {
  /** The bytes to upload — a File from a picker or a Blob assembled from MediaRecorder. */
  file: Blob
  /** Storage object key, e.g. `<org_id>/<recording_id>/<filename>`. */
  storagePath: string
  /** TUS endpoint returned by the create/attach route. */
  endpoint: string
  /** Storage bucket name. */
  bucket: string
  /** The user's Supabase session access token. */
  sessionJwt: string
  /** Content type to store; defaults to the blob's type or octet-stream. */
  contentType?: string
  onProgress?: (fraction: number) => void
}

export function tusUpload(args: TusUploadArgs): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(args.file, {
      endpoint: args.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { Authorization: `Bearer ${args.sessionJwt}`, 'x-upsert': 'true' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: args.bucket,
        objectName: args.storagePath,
        contentType: args.contentType || args.file.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024,
      onProgress: (sent, total) => { if (total > 0) args.onProgress?.(sent / total) },
      onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      onSuccess: () => resolve(),
    })
    upload.start()
  })
}

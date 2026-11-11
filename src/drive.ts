import { DRIVE_API_BASE } from './constants.js'
import { EXPORT_FORMATS, GOOGLE_SHEET_MIME } from './mime.js'
import type { ExportFormat } from './types.js'

/** Error with an HTTP status that is safe to show to the end user. */
export class DriveError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'DriveError'
    this.status = status
  }
}

export interface DriveFileMetadata {
  id: string
  mimeType: string
  modifiedTime?: string
  name: string
  size?: string
  trashed?: boolean
}

const authHeaders = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` })

/** Turn a failed Drive response into a DriveError without leaking the token. */
const toDriveError = async (response: Response): Promise<DriveError> => {
  let reason = ''
  let message = ''
  try {
    const body = (await response.json()) as {
      error?: { errors?: Array<{ reason?: string }>; message?: string }
    }
    reason = body.error?.errors?.[0]?.reason ?? ''
    message = body.error?.message ?? ''
  } catch {
    // ignore non-JSON error bodies
  }

  if (response.status === 401) {
    return new DriveError('The Google access token is invalid or has expired. Please try again.', 401)
  }
  if (reason === 'exportSizeLimitExceeded') {
    return new DriveError('Google can only export spreadsheets up to 10 MB.', 413)
  }
  if (response.status === 403 || response.status === 404) {
    return new DriveError(
      'Google Drive did not allow access to this file. Pick it again with the Google Picker.',
      403,
    )
  }
  return new DriveError(message || `Google Drive request failed (${response.status}).`, 502)
}

export const getFileMetadata = async (
  fileId: string,
  accessToken: string,
): Promise<DriveFileMetadata> => {
  const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`)
  url.searchParams.set('fields', 'id,name,mimeType,size,modifiedTime,trashed')
  url.searchParams.set('supportsAllDrives', 'true')

  const response = await fetch(url, { headers: authHeaders(accessToken) })
  if (!response.ok) throw await toDriveError(response)
  return (await response.json()) as DriveFileMetadata
}

/** Read a response body into a Buffer, aborting as soon as it exceeds `maxBytes`. */
export const readLimited = async (response: Response, maxBytes: number): Promise<Buffer> => {
  const tooLarge = () =>
    new DriveError(`The file is larger than the allowed ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413)

  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge()

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw tooLarge()
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export const downloadFile = async ({
  accessToken,
  exportFormat,
  fileId,
  maxBytes,
  sourceMimeType,
}: {
  accessToken: string
  exportFormat: ExportFormat
  fileId: string
  maxBytes: number
  sourceMimeType: string
}): Promise<Buffer> => {
  const isNative = sourceMimeType === GOOGLE_SHEET_MIME
  const url = new URL(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}${isNative ? '/export' : ''}`,
  )
  if (isNative) {
    url.searchParams.set('mimeType', EXPORT_FORMATS[exportFormat].mimeType)
  } else {
    url.searchParams.set('alt', 'media')
    url.searchParams.set('supportsAllDrives', 'true')
  }

  const response = await fetch(url, { headers: authHeaders(accessToken) })
  if (!response.ok) throw await toDriveError(response)
  return readLimited(response, maxBytes)
}

import type { Endpoint, PayloadHandler } from 'payload'

import { IMPORT_ENDPOINT_PATH, WORKBOOK_CONTEXT_KEY } from '../constants.js'
import { DriveError, downloadFile, getFileMetadata } from '../drive.js'
import { buildFilename, getOutputMimeType, GOOGLE_SHEET_MIME, XLSX_MIME } from '../mime.js'
import type { SanitizedGoogleDriveOptions, SpreadsheetWorkbook } from '../types.js'
import { parseWorkbook } from '../workbook.js'

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/

const json = (body: Record<string, unknown>, status: number) => Response.json(body, { status })

export const createImportHandler =
  (
    options: SanitizedGoogleDriveOptions,
    collectionSlug: string = options.collectionSlug,
  ): PayloadHandler =>
  async (req) => {
    if (!req.user) return json({ error: 'You must be logged in.' }, 401)

    let body: { accessToken?: unknown; fileId?: unknown } | undefined
    try {
      body = (await req.json?.()) as typeof body
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400)
    }

    const accessToken = body?.accessToken
    const fileId = body?.fileId
    if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 4096) {
      return json({ error: 'A Google access token is required.' }, 400)
    }
    if (typeof fileId !== 'string' || !FILE_ID_PATTERN.test(fileId)) {
      return json({ error: 'A valid Google Drive file id is required.' }, 400)
    }

    try {
      const metadata = await getFileMetadata(fileId, accessToken)

      // The Picker already filters by type, but the client is untrusted.
      if (!options.allowedMimeTypes.includes(metadata.mimeType)) {
        return json({ error: 'This type of file is not allowed.' }, 400)
      }
      if (metadata.trashed) {
        return json({ error: 'This file is in the Google Drive trash.' }, 400)
      }
      if (metadata.mimeType !== GOOGLE_SHEET_MIME && Number(metadata.size) > options.maxFileSize) {
        return json({ error: 'The file is larger than the allowed size.' }, 413)
      }

      const data = await downloadFile({
        accessToken,
        exportFormat: options.exportFormat,
        fileId: metadata.id,
        maxBytes: options.maxFileSize,
        sourceMimeType: metadata.mimeType,
      })

      const outputMimeType = getOutputMimeType(metadata.mimeType, options.exportFormat)

      // Parse .xlsx files once, here, so computations never need the raw file
      // (works with any storage adapter). A parse failure doesn't block the import.
      let workbook: SpreadsheetWorkbook | undefined
      if (options.parseSpreadsheets && outputMimeType === XLSX_MIME) {
        try {
          workbook = await parseWorkbook(data, { maxCells: options.maxParsedCells })
        } catch (error) {
          req.payload.logger.warn({ err: error, msg: 'Could not parse the imported spreadsheet' })
        }
      }

      const doc = await req.payload.create({
        collection: collectionSlug as never,
        context: { [WORKBOOK_CONTEXT_KEY]: workbook },
        data: {
          driveFileId: metadata.id,
          driveMimeType: metadata.mimeType,
          driveModifiedTime: metadata.modifiedTime,
          owner: req.user.id,
        } as never,
        file: {
          name: buildFilename(metadata.name, metadata.mimeType, options.exportFormat),
          data,
          mimetype: outputMimeType,
          size: data.length,
        },
        overrideAccess: false, // honour the collection's access rules
        req,
        user: req.user,
      })

      const created = doc as unknown as Record<string, unknown>
      return json(
        {
          doc: {
            id: created.id,
            filename: created.filename,
            filesize: created.filesize,
            mimeType: created.mimeType,
            url: created.url,
          },
        },
        201,
      )
    } catch (error) {
      if (error instanceof DriveError) return json({ error: error.message }, error.status)

      const status = (error as { status?: number })?.status
      if (typeof status === 'number' && status >= 400 && status < 500) {
        return json({ error: (error as Error).message }, status)
      }

      // Never log the request body: it contains the user's access token.
      req.payload.logger.error({ err: error, msg: 'Google Drive import failed' })
      return json({ error: 'Importing the file failed.' }, 500)
    }
  }

export const createImportEndpoint = (
  options: SanitizedGoogleDriveOptions,
  collectionSlug?: string,
): Endpoint => ({
  handler: createImportHandler(options, collectionSlug),
  method: 'post',
  path: IMPORT_ENDPOINT_PATH,
})

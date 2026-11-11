import type { Field, FieldHook, GroupField, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'

import { DEFAULT_COLLECTION_SLUG, PACKAGE_NAME } from '../constants.js'
import { GOOGLE_SHEET_MIME, XLSX_MIME } from '../mime.js'
import type {
  GoogleDriveSpreadsheetFieldOptions,
  SpreadsheetFileInfo,
  SpreadsheetWorkbook,
} from '../types.js'
import { isWorkbook } from '../workbook.js'

const FILE_FIELD = 'file'
const COMPUTED_FIELD = 'computed'

type FileDoc = {
  driveFileId?: string
  driveModifiedTime?: string
  filename: string
  id: number | string
  mimeType?: string
  owner?: unknown
  workbook?: unknown
}

const idOf = (value: unknown): null | number | string => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return idOf((value as { id?: unknown }).id)
  return value as number | string
}

const sameId = (a: unknown, b: unknown): boolean => {
  const left = idOf(a)
  const right = idOf(b)
  return left !== null && right !== null && String(left) === String(right)
}

/** Read the file record bypassing access control; callers do their own checks. */
const loadFileDoc = async (
  req: PayloadRequest,
  collectionSlug: string,
  id: number | string,
): Promise<FileDoc | null> => {
  try {
    return (await req.payload.findByID({
      id,
      collection: collectionSlug as never,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as FileDoc
  } catch {
    return null
  }
}

const toJsonSafe = (value: unknown): unknown =>
  value === undefined ? null : JSON.parse(JSON.stringify(value))

/**
 * Runs when the chosen file changes. This is the server-side guard: the admin
 * UI only offers the user's own files, but the API can be called directly.
 */
const validateChosenFile =
  (collectionSlug: string): FieldHook =>
  async ({ path, previousValue, req, value }) => {
    const id = idOf(value)
    if (id === null || sameId(value, previousValue)) return value

    const fail = (message: string): never => {
      throw new ValidationError({ errors: [{ message, path: path.join('.') }], req })
    }

    const doc = await loadFileDoc(req, collectionSlug, id)
    if (!doc) return fail('The selected file does not exist.')

    // Editors may only attach files they imported themselves. Trusted server
    // code (Local API without a user) is not restricted.
    if (req.user && !sameId(doc.owner, req.user.id)) {
      return fail('You can only use spreadsheets that you imported yourself.')
    }
    if (doc.mimeType !== XLSX_MIME) return fail('The selected file is not an .xlsx spreadsheet.')
    if (!isWorkbook(doc.workbook)) {
      return fail(
        'The spreadsheet could not be read. Import it again, and make sure "parseSpreadsheets" is enabled.',
      )
    }
    if (doc.workbook.truncated) {
      return fail('The spreadsheet is too large to process. Reduce it or raise "maxParsedCells".')
    }
    return value
  }

const computeOnSave =
  (
    collectionSlug: string,
    compute: NonNullable<GoogleDriveSpreadsheetFieldOptions['compute']>,
  ): FieldHook =>
  async ({ path, previousSiblingDoc, req, siblingData }) => {
    const fileId = idOf((siblingData as Record<string, unknown>)[FILE_FIELD])
    if (fileId === null) return null

    // Never trust a `computed` value sent by a client: keep the stored one if
    // we can't recompute.
    const stored = (previousSiblingDoc as Record<string, unknown> | undefined)?.[COMPUTED_FIELD]
    const fileUnchanged = sameId(
      fileId,
      (previousSiblingDoc as Record<string, unknown> | undefined)?.[FILE_FIELD],
    )

    const doc = await loadFileDoc(req, collectionSlug, fileId)
    if (!doc || !isWorkbook(doc.workbook) || doc.workbook.truncated) {
      // The file chooser hook already rejected changed files that are unusable.
      if (fileUnchanged && stored !== undefined) return stored
      throw new ValidationError({
        errors: [{ message: 'The spreadsheet data is not available.', path: path.join('.') }],
        req,
      })
    }

    const file: SpreadsheetFileInfo = {
      id: doc.id,
      driveFileId: doc.driveFileId,
      driveModifiedTime: doc.driveModifiedTime,
      filename: doc.filename,
    }

    try {
      const result = await compute({
        file,
        req,
        siblingData: siblingData as Record<string, unknown>,
        workbook: doc.workbook as SpreadsheetWorkbook,
      })
      return toJsonSafe(result)
    } catch (error) {
      if (error instanceof ValidationError) throw error
      const message = error instanceof Error ? error.message : 'The spreadsheet could not be processed.'
      throw new ValidationError({ errors: [{ message, path: path.join('.') }], req })
    }
  }

/**
 * A field for any block/collection that lets an author pick an `.xlsx` file
 * from their Google Drive. The file is imported into Payload (owner-only), its
 * cells are parsed server-side, and an optional `compute()` callback turns them
 * into a result stored with the document.
 *
 * The result is a `group` with `file` (relationship) and, if `compute` is set,
 * `computed` (json).
 */
export const googleDriveSpreadsheetField = (
  options: GoogleDriveSpreadsheetFieldOptions,
): GroupField => {
  const collectionSlug = options.collectionSlug ?? DEFAULT_COLLECTION_SLUG
  const mimeTypes = [...new Set(options.mimeTypes ?? [GOOGLE_SHEET_MIME, XLSX_MIME])]

  for (const mimeType of mimeTypes) {
    if (mimeType !== GOOGLE_SHEET_MIME && mimeType !== XLSX_MIME) {
      throw new Error(
        `[payload-plugin-google-drive] googleDriveSpreadsheetField only supports Google Sheets and .xlsx files, got "${mimeType}".`,
      )
    }
  }
  if (mimeTypes.length === 0) {
    throw new Error('[payload-plugin-google-drive] "mimeTypes" must not be empty.')
  }

  const fields: Field[] = [
    {
      name: FILE_FIELD,
      type: 'relationship',
      admin: {
        components: {
          Field: {
            clientProps: { collectionSlug, mimeTypes },
            path: `${PACKAGE_NAME}/client#SpreadsheetPickerField`,
          },
        },
        description: options.description,
      },
      hooks: { beforeChange: [validateChosenFile(collectionSlug)] },
      label: options.label ?? 'Spreadsheet (.xlsx)',
      relationTo: collectionSlug,
      required: options.required,
    },
  ]

  if (options.compute) {
    fields.push({
      name: COMPUTED_FIELD,
      type: 'json',
      admin: {
        description: 'Calculated from the spreadsheet every time this is saved.',
        hidden: !options.showComputed,
        readOnly: true,
      },
      hooks: { beforeChange: [computeOnSave(collectionSlug, options.compute)] },
    })
  }

  return {
    name: options.name,
    type: 'group',
    admin: { hideGutter: true },
    fields,
    // The label is shown by the file picker field inside the group.
    label: false,
  }
}

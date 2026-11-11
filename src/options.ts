import {
  DEFAULT_BUTTON_LABEL,
  DEFAULT_COLLECTION_SLUG,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_PARSED_CELLS,
} from './constants.js'
import { GOOGLE_SHEET_MIME, SUPPORTED_SOURCE_MIME_TYPES } from './mime.js'
import type { ExportFormat, GoogleDrivePluginOptions, SanitizedGoogleDriveOptions } from './types.js'

const EXPORT_FORMAT_KEYS: ExportFormat[] = ['csv', 'ods', 'pdf', 'tsv', 'xlsx']

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[payload-plugin-google-drive] The "${name}" option is required.`)
  }
  return value.trim()
}

/** Validate user options and apply defaults. Throws a helpful error early. */
export const sanitizeOptions = (
  options: GoogleDrivePluginOptions,
): SanitizedGoogleDriveOptions => {
  const disabled = options?.disabled === true

  // A disabled plugin must not break the app just because env vars are unset.
  const clientId = disabled ? (options?.clientId ?? '') : requireString(options?.clientId, 'clientId')
  const apiKey = disabled ? (options?.apiKey ?? '') : requireString(options?.apiKey, 'apiKey')
  const appId = disabled ? (options?.appId ?? '') : requireString(options?.appId, 'appId')

  if (!disabled && !/^\d+$/.test(appId)) {
    throw new Error(
      '[payload-plugin-google-drive] "appId" must be the numeric Google Cloud project NUMBER (not the project id).',
    )
  }

  const exportFormat = options?.exportFormat ?? 'xlsx'
  if (!EXPORT_FORMAT_KEYS.includes(exportFormat)) {
    throw new Error(
      `[payload-plugin-google-drive] Unsupported "exportFormat" "${exportFormat}". Use one of: ${EXPORT_FORMAT_KEYS.join(', ')}.`,
    )
  }

  const allowedMimeTypes = [...new Set(options?.allowedMimeTypes ?? [GOOGLE_SHEET_MIME])]
  if (allowedMimeTypes.length === 0) {
    throw new Error('[payload-plugin-google-drive] "allowedMimeTypes" must not be empty.')
  }
  for (const mimeType of allowedMimeTypes) {
    if (!SUPPORTED_SOURCE_MIME_TYPES.includes(mimeType)) {
      throw new Error(
        `[payload-plugin-google-drive] Unsupported mime type "${mimeType}". Supported: ${SUPPORTED_SOURCE_MIME_TYPES.join(', ')}.`,
      )
    }
  }

  const maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
  if (!Number.isFinite(maxFileSize) || maxFileSize <= 0) {
    throw new Error('[payload-plugin-google-drive] "maxFileSize" must be a positive number of bytes.')
  }

  const maxParsedCells = options?.maxParsedCells ?? DEFAULT_MAX_PARSED_CELLS
  if (!Number.isFinite(maxParsedCells) || maxParsedCells <= 0) {
    throw new Error('[payload-plugin-google-drive] "maxParsedCells" must be a positive number.')
  }

  return {
    allowedMimeTypes,
    apiKey,
    appId,
    buttonLabel: options?.buttonLabel ?? DEFAULT_BUTTON_LABEL,
    clientId,
    collectionOverride: options?.collectionOverride,
    collectionSlug: options?.collectionSlug ?? DEFAULT_COLLECTION_SLUG,
    disabled,
    exportFormat,
    isAdmin: options?.isAdmin,
    maxFileSize,
    maxParsedCells,
    multiple: options?.multiple ?? true,
    parseSpreadsheets: options?.parseSpreadsheets ?? true,
    staticDir: options?.staticDir,
  }
}

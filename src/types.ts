import type { CollectionConfig, PayloadRequest } from 'payload'

/** A single spreadsheet cell. Dates are converted to ISO-8601 strings. */
export type SpreadsheetCell = boolean | number | string | null

export interface SpreadsheetSheet {
  name: string
  /** Row-major, 0-based. Empty trailing rows are dropped. */
  rows: SpreadsheetCell[][]
}

/** JSON snapshot of an imported `.xlsx` file (cell values; formulas are their cached results). */
export interface SpreadsheetWorkbook {
  sheets: SpreadsheetSheet[]
  /** `true` if the file exceeded `maxParsedCells` and the data is incomplete. */
  truncated: boolean
}

export interface SpreadsheetFileInfo {
  driveFileId?: string
  driveModifiedTime?: string
  filename: string
  id: number | string
}

export interface SpreadsheetComputeArgs {
  /** The imported file record. */
  file: SpreadsheetFileInfo
  req: PayloadRequest
  /** The data of the group the field lives in (e.g. the other values of the block). */
  siblingData: Record<string, unknown>
  workbook: SpreadsheetWorkbook
}

export interface GoogleDriveSpreadsheetFieldOptions {
  /** Slug of the plugin's collection. Must match the plugin's `collectionSlug`. @default 'google-drive-files' */
  collectionSlug?: string
  /**
   * Runs on the server every time the document is saved. Its (JSON-serialisable)
   * return value is stored next to the file in a hidden `computed` field. Throw
   * to reject the save with an error message. Without `compute`, no `computed`
   * field is created and you read the workbook yourself (see `getWorkbook`).
   */
  compute?: (args: SpreadsheetComputeArgs) => unknown | Promise<unknown>
  /** Help text shown under the label. */
  description?: string
  /** Label of the field. */
  label?: string
  /**
   * Which Drive files the Picker offers. Both end up as `.xlsx` in Payload as
   * long as the plugin's `exportFormat` is `'xlsx'` (the default).
   * @default ['application/vnd.google-apps.spreadsheet', '.xlsx mime type']
   */
  mimeTypes?: string[]
  /** Name of the group field. */
  name: string
  /** Require a spreadsheet to be chosen. */
  required?: boolean
  /** Show the stored `computed` value (read-only) in the admin UI, for debugging. */
  showComputed?: boolean
}

/**
 * Format a native Google Sheet is exported to when it is imported.
 * Note: Google only exports the *first sheet* for `csv` and `tsv`. Use `xlsx`
 * (default) or `ods` to keep every sheet.
 */
export type ExportFormat = 'csv' | 'ods' | 'pdf' | 'tsv' | 'xlsx'

/** Minimal shape of an authenticated Payload user, as seen by this plugin. */
export type PluginUser = { id: number | string } & Record<string, unknown>

export type CollectionOverride = (args: {
  defaultCollection: CollectionConfig
}) => CollectionConfig | Promise<CollectionConfig>

export interface GoogleDrivePluginOptions {
  /**
   * Google Cloud API key (restrict it to the Picker API and to your admin
   * origin as an HTTP referrer). It is sent to the browser, which is expected.
   */
  apiKey: string
  /**
   * Numeric Google Cloud **project number** (not the project id). Required by
   * the Picker so that the `drive.file` scope grants access to picked files.
   */
  appId: string
  /** OAuth 2.0 *Web application* client id. Sent to the browser. */
  clientId: string

  /**
   * Which Drive file types authors may pick. Defaults to native Google Sheets
   * only. Supported: Google Sheets, `.xlsx`, `.csv`, `.ods`, `.tsv`.
   * @default ['application/vnd.google-apps.spreadsheet']
   */
  allowedMimeTypes?: string[]
  /** Label for the button shown above the collection list. */
  buttonLabel?: string
  /**
   * Override or replace the generated upload collection. Receives the default
   * collection and must return the final one (may be async).
   */
  collectionOverride?: CollectionOverride
  /**
   * Slug of the upload collection the plugin creates.
   * @default 'google-drive-files'
   */
  collectionSlug?: string
  /**
   * Keep the collection in the schema (so database migrations stay stable) but
   * disable the endpoint and the admin button.
   */
  disabled?: boolean
  /** Export format for native Google Sheets. @default 'xlsx' */
  exportFormat?: ExportFormat
  /**
   * Return `true` for users who may read/update/delete *everyone's* imported
   * files. By default the files are strictly owner-only, admins included.
   */
  isAdmin?: (user: PluginUser) => boolean
  /** Maximum size (bytes) of a single imported file. @default 25 MB */
  maxFileSize?: number
  /** Max cells stored per imported workbook (rest is dropped, `truncated: true`). @default 250_000 */
  maxParsedCells?: number
  /** Allow picking several files at once. @default true */
  multiple?: boolean
  /**
   * Parse imported `.xlsx` files on the server and store their cell values as
   * JSON on the file record (needed by `googleDriveSpreadsheetField`).
   * @default true
   */
  parseSpreadsheets?: boolean
  /**
   * Directory the files are stored in (absolute, or relative to your Payload
   * config). Keep it OUTSIDE your public folder.
   */
  staticDir?: string
}

export interface SanitizedGoogleDriveOptions {
  allowedMimeTypes: string[]
  apiKey: string
  appId: string
  buttonLabel: string
  clientId: string
  collectionOverride?: CollectionOverride
  collectionSlug: string
  disabled: boolean
  exportFormat: ExportFormat
  isAdmin?: (user: PluginUser) => boolean
  maxFileSize: number
  maxParsedCells: number
  multiple: boolean
  parseSpreadsheets: boolean
  staticDir?: string
}

import type { ExportFormat } from './types.js'

export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_MIME = 'text/csv'
export const TSV_MIME = 'text/tab-separated-values'
export const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet'
export const PDF_MIME = 'application/pdf'

/** What a native Google Sheet can be exported as. */
export const EXPORT_FORMATS: Record<ExportFormat, { extension: string; mimeType: string }> = {
  csv: { extension: 'csv', mimeType: CSV_MIME },
  ods: { extension: 'ods', mimeType: ODS_MIME },
  pdf: { extension: 'pdf', mimeType: PDF_MIME },
  tsv: { extension: 'tsv', mimeType: TSV_MIME },
  xlsx: { extension: 'xlsx', mimeType: XLSX_MIME },
}

/** Extension used for non-native files, keyed by their Drive mime type. */
const SOURCE_EXTENSIONS: Record<string, string> = {
  [CSV_MIME]: 'csv',
  [ODS_MIME]: 'ods',
  [TSV_MIME]: 'tsv',
  [XLSX_MIME]: 'xlsx',
}

/** Drive mime types this plugin knows how to import. */
export const SUPPORTED_SOURCE_MIME_TYPES: readonly string[] = [
  GOOGLE_SHEET_MIME,
  ...Object.keys(SOURCE_EXTENSIONS),
]

/** Mime type of the file that ends up stored in Payload. */
export const getOutputMimeType = (sourceMimeType: string, exportFormat: ExportFormat): string =>
  sourceMimeType === GOOGLE_SHEET_MIME ? EXPORT_FORMATS[exportFormat].mimeType : sourceMimeType

/** Deduplicated list of mime types the upload collection should accept. */
export const getOutputMimeTypes = (
  sourceMimeTypes: readonly string[],
  exportFormat: ExportFormat,
): string[] => [...new Set(sourceMimeTypes.map((m) => getOutputMimeType(m, exportFormat)))]

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g

/**
 * Build a safe filename that always carries the right extension, e.g.
 * `Budget 2026` (Google Sheet) -> `Budget 2026.xlsx`.
 */
export const buildFilename = (
  driveName: string,
  sourceMimeType: string,
  exportFormat: ExportFormat,
): string => {
  const base =
    driveName
      .replace(INVALID_FILENAME_CHARS, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 150) || 'google-drive-file'

  const extension =
    sourceMimeType === GOOGLE_SHEET_MIME
      ? EXPORT_FORMATS[exportFormat].extension
      : SOURCE_EXTENSIONS[sourceMimeType]

  if (!extension) return base
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`
}

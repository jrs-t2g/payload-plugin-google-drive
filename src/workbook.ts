import type { Payload } from 'payload'
import readXlsxFile from 'read-excel-file/node'

import { DEFAULT_COLLECTION_SLUG, DEFAULT_MAX_PARSED_CELLS } from './constants.js'
import { XLSX_MIME } from './mime.js'
import type { SpreadsheetCell, SpreadsheetSheet, SpreadsheetWorkbook } from './types.js'

const normalizeCell = (value: unknown): SpreadsheetCell => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || typeof value === 'string') return value
  return String(value)
}

/**
 * Parse an `.xlsx` buffer into plain JSON. Values only: formulas are returned
 * as the result Excel/Sheets cached in the file.
 *
 * @throws if the buffer is not a valid `.xlsx` file.
 */
export const parseWorkbook = async (
  buffer: Buffer,
  { maxCells = DEFAULT_MAX_PARSED_CELLS }: { maxCells?: number } = {},
): Promise<SpreadsheetWorkbook> => {
  const parsed = await readXlsxFile(buffer)

  const sheets: SpreadsheetSheet[] = []
  let cellCount = 0
  let truncated = false

  outer: for (const { data, sheet } of parsed) {
    const rows: SpreadsheetCell[][] = []
    for (const row of data) {
      if (cellCount + row.length > maxCells) {
        truncated = true
        sheets.push({ name: sheet, rows })
        break outer
      }
      cellCount += row.length
      rows.push(row.map(normalizeCell))
    }
    sheets.push({ name: sheet, rows })
  }

  return { sheets, truncated }
}

export const isWorkbook = (value: unknown): value is SpreadsheetWorkbook =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as SpreadsheetWorkbook).sheets) &&
  typeof (value as SpreadsheetWorkbook).truncated === 'boolean'

/** Find a sheet by name (case-sensitive) or 0-based index. */
export const getSheet = (
  workbook: SpreadsheetWorkbook,
  nameOrIndex: number | string = 0,
): SpreadsheetSheet | undefined =>
  typeof nameOrIndex === 'number'
    ? workbook.sheets[nameOrIndex]
    : workbook.sheets.find((sheet) => sheet.name === nameOrIndex)

/**
 * Turn a sheet into objects keyed by the header row.
 * `[['name','qty'],['a',1]]` -> `[{ name: 'a', qty: 1 }]`. Blank headers are skipped.
 */
export const sheetToObjects = (
  sheet: SpreadsheetSheet,
  { headerRow = 0 }: { headerRow?: number } = {},
): Record<string, SpreadsheetCell>[] => {
  const header = sheet.rows[headerRow]
  if (!header) return []

  return sheet.rows.slice(headerRow + 1).map((row) => {
    const record: Record<string, SpreadsheetCell> = {}
    header.forEach((title, column) => {
      if (typeof title === 'string' && title.trim() !== '') record[title.trim()] = row[column] ?? null
    })
    return record
  })
}

/**
 * Server-side helper for blocks/pages: load the stored workbook of an imported
 * file (e.g. in a React Server Component) without exposing the raw file.
 *
 * Bypasses access control on purpose, so only call it with ids that come from
 * your own documents, never with user input.
 */
export const getWorkbook = async (
  payload: Payload,
  fileOrId: unknown,
  { collectionSlug = DEFAULT_COLLECTION_SLUG }: { collectionSlug?: string } = {},
): Promise<null | SpreadsheetWorkbook> => {
  const id =
    typeof fileOrId === 'object' && fileOrId !== null && 'id' in fileOrId
      ? (fileOrId as { id: number | string }).id
      : (fileOrId as null | number | string | undefined)
  if (id === null || id === undefined || id === '') return null

  try {
    const doc = (await payload.findByID({
      id,
      collection: collectionSlug as never,
      depth: 0,
      overrideAccess: true,
    })) as unknown as { mimeType?: string; workbook?: unknown }
    return doc.mimeType === XLSX_MIME && isWorkbook(doc.workbook) ? doc.workbook : null
  } catch {
    return null
  }
}

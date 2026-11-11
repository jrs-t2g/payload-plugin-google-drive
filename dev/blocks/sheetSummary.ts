import type { Block } from 'payload'

import { googleDriveSpreadsheetField } from '../../src/index.js'

/**
 * Example block: the author picks an .xlsx from Google Drive, and the server
 * computes a summary from it every time the page is saved. Only the computed
 * result lives in the (public) page; the raw file stays private to its owner.
 */
export const SheetSummary: Block = {
  slug: 'sheetSummary',
  interfaceName: 'SheetSummaryBlock',
  labels: { plural: 'Sheet summaries', singular: 'Sheet summary' },
  fields: [
    { name: 'heading', type: 'text' },
    googleDriveSpreadsheetField({
      name: 'sheet',
      description: 'Pick an .xlsx file or a Google Sheet from your Google Drive.',
      label: 'Spreadsheet',
      required: true,
      showComputed: true,
      compute: ({ file, workbook }) => {
        const sheets = workbook.sheets.map((sheet) => {
          const numbers = sheet.rows.flat().filter((cell): cell is number => typeof cell === 'number')
          return {
            name: sheet.name,
            numericCells: numbers.length,
            rowCount: sheet.rows.length,
            sum: numbers.reduce((total, n) => total + n, 0),
          }
        })

        return {
          source: file.filename,
          sheets,
          total: sheets.reduce((total, sheet) => total + sheet.sum, 0),
        }
      },
    }),
  ],
}

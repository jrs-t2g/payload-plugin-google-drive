import { describe, expect, it } from 'vitest'

import {
  buildFilename,
  CSV_MIME,
  getOutputMimeType,
  getOutputMimeTypes,
  GOOGLE_SHEET_MIME,
  XLSX_MIME,
} from '../src/mime.js'
import { sanitizeOptions } from '../src/options.js'

const valid = { apiKey: 'key', appId: '1234567890', clientId: 'id.apps.googleusercontent.com' }

describe('mime helpers', () => {
  it('maps a Google Sheet to the export mime type', () => {
    expect(getOutputMimeType(GOOGLE_SHEET_MIME, 'xlsx')).toBe(XLSX_MIME)
    expect(getOutputMimeType(GOOGLE_SHEET_MIME, 'csv')).toBe(CSV_MIME)
    expect(getOutputMimeType(CSV_MIME, 'xlsx')).toBe(CSV_MIME)
  })

  it('deduplicates output mime types', () => {
    expect(getOutputMimeTypes([GOOGLE_SHEET_MIME, XLSX_MIME], 'xlsx')).toEqual([XLSX_MIME])
  })

  it('builds safe filenames with the right extension', () => {
    expect(buildFilename('Budget 2026', GOOGLE_SHEET_MIME, 'xlsx')).toBe('Budget 2026.xlsx')
    expect(buildFilename('data.XLSX', XLSX_MIME, 'xlsx')).toBe('data.XLSX')
    expect(buildFilename('report', CSV_MIME, 'xlsx')).toBe('report.csv')
    expect(buildFilename('../../etc/passwd', GOOGLE_SHEET_MIME, 'csv')).toBe('_.._etc_passwd.csv')
    expect(buildFilename('   ', GOOGLE_SHEET_MIME, 'xlsx')).toBe('google-drive-file.xlsx')
  })
})

describe('sanitizeOptions', () => {
  it('applies defaults', () => {
    const options = sanitizeOptions(valid)
    expect(options.collectionSlug).toBe('google-drive-files')
    expect(options.allowedMimeTypes).toEqual([GOOGLE_SHEET_MIME])
    expect(options.exportFormat).toBe('xlsx')
    expect(options.multiple).toBe(true)
    expect(options.maxFileSize).toBe(25 * 1024 * 1024)
  })

  it('requires credentials unless disabled', () => {
    expect(() => sanitizeOptions({ ...valid, clientId: '' })).toThrow(/clientId/)
    expect(() => sanitizeOptions({ ...valid, apiKey: ' ' })).toThrow(/apiKey/)
    expect(() => sanitizeOptions({ apiKey: '', appId: '', clientId: '', disabled: true })).not.toThrow()
  })

  it('requires a numeric project number', () => {
    expect(() => sanitizeOptions({ ...valid, appId: 'my-project' })).toThrow(/project NUMBER/)
  })

  it('rejects unsupported mime types and formats', () => {
    expect(() => sanitizeOptions({ ...valid, allowedMimeTypes: ['image/png'] })).toThrow(/Unsupported mime/)
    expect(() => sanitizeOptions({ ...valid, allowedMimeTypes: [] })).toThrow(/empty/)
    expect(() => sanitizeOptions({ ...valid, exportFormat: 'docx' as never })).toThrow(/exportFormat/)
    expect(() => sanitizeOptions({ ...valid, maxFileSize: 0 })).toThrow(/maxFileSize/)
  })
})

import type { PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyWorkbookFromContext } from '../src/workbookHook.js'
import { createConfigEndpoint } from '../src/endpoints/config.js'
import { createImportHandler } from '../src/endpoints/import.js'
import { GOOGLE_SHEET_MIME, XLSX_MIME } from '../src/mime.js'
import { sanitizeOptions } from '../src/options.js'
import { buildXlsx } from './helpers/xlsx.js'

const valid = { apiKey: 'key', appId: '1234567890', clientId: 'id.apps.googleusercontent.com' }
const TOKEN = 'ya29.' + 'x'.repeat(40)
const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'

afterEach(() => vi.unstubAllGlobals())

describe('config endpoint', () => {
  const endpoint = createConfigEndpoint(sanitizeOptions(valid))
  const call = (user?: unknown) => endpoint.handler({ user } as unknown as PayloadRequest) as Response

  it('is a GET endpoint', () => {
    expect(endpoint.method).toBe('get')
    expect(endpoint.path).toBe('/google-drive/config')
  })

  it('refuses anonymous visitors', () => {
    expect(call().status).toBe(401)
  })

  it('returns the picker settings to logged-in users', async () => {
    const response = call({ id: 1 })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      allowedMimeTypes: [GOOGLE_SHEET_MIME],
      apiKey: 'key',
      appId: '1234567890',
      clientId: 'id.apps.googleusercontent.com',
      exportFormat: 'xlsx',
    })
  })
})

describe('import endpoint parses xlsx files', () => {
  const makeReq = () => {
    const create = vi.fn(async (args: Record<string, unknown>) => ({
      id: 1,
      filename: (args.file as { name: string }).name,
      filesize: 1,
      mimeType: (args.file as { mimetype: string }).mimetype,
      url: '/x',
    }))
    const warn = vi.fn()
    const req = {
      json: async () => ({ accessToken: TOKEN, fileId: FILE_ID }),
      payload: { create, logger: { error: vi.fn(), warn } },
      user: { id: 5 },
    } as unknown as PayloadRequest
    return { create, req, warn }
  }

  const stubDrive = (fileBytes: Buffer) =>
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ id: FILE_ID, mimeType: GOOGLE_SHEET_MIME, name: 'Prices' }),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array(fileBytes))),
    )

  it('passes the parsed workbook to the collection through the Local API context', async () => {
    stubDrive(buildXlsx({ Prices: [['sku', 'eur'], ['A', 10]] }))
    const { create, req } = makeReq()

    const response = await createImportHandler(sanitizeOptions(valid))(req)

    expect(response.status).toBe(201)
    const args = create.mock.calls[0]![0] as { context: Record<string, unknown>; file: { mimetype: string } }
    expect(args.file.mimetype).toBe(XLSX_MIME)
    expect(args.context.googleDriveWorkbook).toEqual({
      sheets: [{ name: 'Prices', rows: [['sku', 'eur'], ['A', 10]] }],
      truncated: false,
    })
  })

  it('still imports when the file cannot be parsed (and logs a warning)', async () => {
    stubDrive(Buffer.from('not really an xlsx'))
    const { create, req, warn } = makeReq()

    const response = await createImportHandler(sanitizeOptions(valid))(req)

    expect(response.status).toBe(201)
    expect((create.mock.calls[0]![0] as { context: Record<string, unknown> }).context.googleDriveWorkbook).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('skips parsing when parseSpreadsheets is false', async () => {
    stubDrive(buildXlsx({ S: [['a']] }))
    const { create, req } = makeReq()

    await createImportHandler(sanitizeOptions({ ...valid, parseSpreadsheets: false }))(req)

    expect((create.mock.calls[0]![0] as { context: Record<string, unknown> }).context.googleDriveWorkbook).toBeUndefined()
  })
})

describe('applyWorkbookFromContext hook', () => {
  const run = (args: Record<string, unknown>) =>
    applyWorkbookFromContext({ req: {}, ...args } as never) as Record<string, unknown>

  const wb = { sheets: [], truncated: false }

  it('takes the workbook from the Local API context on create', () => {
    expect(run({ context: { googleDriveWorkbook: wb }, data: {}, operation: 'create' }).workbook).toBe(wb)
  })

  it('ignores a workbook sent by a client', () => {
    expect(run({ context: {}, data: { workbook: { sheets: ['forged'] } }, operation: 'create' }).workbook).toBeNull()
  })

  it('keeps the stored workbook on ordinary updates, even if a client sends another', () => {
    const result = run({
      context: {},
      data: { workbook: { sheets: ['forged'] } },
      operation: 'update',
      originalDoc: { workbook: wb },
    })
    expect(result.workbook).toBe(wb)
  })

  it('clears the workbook when a new file replaces the old one', () => {
    const result = run({
      context: {},
      data: {},
      operation: 'update',
      originalDoc: { workbook: wb },
      req: { file: { name: 'new.xlsx' } },
    })
    expect(result.workbook).toBeNull()
  })
})

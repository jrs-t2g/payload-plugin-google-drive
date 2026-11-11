import type { PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createImportHandler } from '../src/endpoints/import.js'
import { GOOGLE_SHEET_MIME, XLSX_MIME } from '../src/mime.js'
import { sanitizeOptions } from '../src/options.js'

const options = sanitizeOptions({
  apiKey: 'key',
  appId: '1234567890',
  clientId: 'id.apps.googleusercontent.com',
  maxFileSize: 1024,
})
const handler = createImportHandler(options)

const TOKEN = 'ya29.' + 'x'.repeat(40)
const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'

const makeReq = (body: unknown, user: unknown = { id: 5 }) => {
  const create = vi.fn(async (args: Record<string, unknown>) => ({
    id: 1,
    filename: (args.file as { name: string }).name,
    filesize: (args.file as { size: number }).size,
    mimeType: (args.file as { mimetype: string }).mimetype,
    url: '/api/google-drive-files/file/x',
  }))
  const req = {
    json: async () => body,
    payload: { create, logger: { error: vi.fn(), warn: vi.fn() } },
    user,
  } as unknown as PayloadRequest
  return { create, req }
}

const mockFetch = (...responses: Response[]) => {
  const fetchMock = vi.fn()
  for (const r of responses) fetchMock.mockResolvedValueOnce(r)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const metadata = (overrides: Record<string, unknown> = {}) =>
  Response.json({ id: FILE_ID, mimeType: GOOGLE_SHEET_MIME, modifiedTime: '2026-01-01T00:00:00Z', name: 'Budget', ...overrides })

afterEach(() => vi.unstubAllGlobals())

describe('import endpoint', () => {
  it('rejects anonymous requests', async () => {
    const { req } = makeReq({ accessToken: TOKEN, fileId: FILE_ID }, undefined)
    expect((await handler(req)).status).toBe(401)
  })

  it('validates the body', async () => {
    expect((await handler(makeReq({ fileId: FILE_ID }).req)).status).toBe(400)
    expect((await handler(makeReq({ accessToken: TOKEN, fileId: '../etc' }).req)).status).toBe(400)
  })

  it('imports a Google Sheet as xlsx, owned by the current user', async () => {
    const fetchMock = mockFetch(metadata(), new Response(Buffer.from('PK-xlsx-bytes')))
    const { create, req } = makeReq({ accessToken: TOKEN, fileId: FILE_ID })

    const response = await handler(req)
    expect(response.status).toBe(201)

    // second call is the export request, with the bearer token
    const [exportUrl, init] = fetchMock.mock.calls[1]!
    expect(String(exportUrl)).toContain(`/files/${FILE_ID}/export`)
    expect(String(exportUrl)).toContain(encodeURIComponent(XLSX_MIME))
    expect((init as RequestInit).headers).toEqual({ Authorization: `Bearer ${TOKEN}` })

    const args = create.mock.calls[0]![0]
    expect(args.collection).toBe('google-drive-files')
    expect(args.overrideAccess).toBe(false)
    expect((args.data as { owner: number }).owner).toBe(5)
    expect(args.file).toMatchObject({ mimetype: XLSX_MIME, name: 'Budget.xlsx' })
  })

  it('rejects file types that are not allowed', async () => {
    mockFetch(metadata({ mimeType: 'application/pdf' }))
    const response = await handler(makeReq({ accessToken: TOKEN, fileId: FILE_ID }).req)
    expect(response.status).toBe(400)
  })

  it('rejects trashed files', async () => {
    mockFetch(metadata({ trashed: true }))
    expect((await handler(makeReq({ accessToken: TOKEN, fileId: FILE_ID }).req)).status).toBe(400)
  })

  it('enforces the size limit while downloading', async () => {
    mockFetch(metadata(), new Response(Buffer.alloc(2048)))
    const { create, req } = makeReq({ accessToken: TOKEN, fileId: FILE_ID })
    expect((await handler(req)).status).toBe(413)
    expect(create).not.toHaveBeenCalled()
  })

  it('maps Drive auth failures without leaking the token', async () => {
    mockFetch(Response.json({ error: { message: 'Invalid Credentials' } }, { status: 401 }))
    const response = await handler(makeReq({ accessToken: TOKEN, fileId: FILE_ID }).req)
    expect(response.status).toBe(401)
    expect(JSON.stringify(await response.json())).not.toContain(TOKEN)
  })

  it('treats a file the user did not pick as forbidden', async () => {
    mockFetch(Response.json({ error: { message: 'File not found' } }, { status: 404 }))
    expect((await handler(makeReq({ accessToken: TOKEN, fileId: FILE_ID }).req)).status).toBe(403)
  })
})

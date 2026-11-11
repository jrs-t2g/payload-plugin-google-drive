import { ValidationError } from 'payload'
import type { Field, FieldHook, GroupField } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { googleDriveSpreadsheetField } from '../src/fields/spreadsheet.js'
import { GOOGLE_SHEET_MIME, XLSX_MIME } from '../src/mime.js'
import type { SpreadsheetWorkbook } from '../src/types.js'

const workbook: SpreadsheetWorkbook = {
  sheets: [{ name: 'S', rows: [['a', 1], ['b', 2]] }],
  truncated: false,
}

const fileDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  driveFileId: 'drive-id',
  filename: 'prices.xlsx',
  mimeType: XLSX_MIME,
  owner: 1,
  workbook,
  ...overrides,
})

const makeReq = (doc: unknown, user: unknown = { id: 1 }) => {
  const findByID = vi.fn(async () => {
    if (doc === 'missing') throw new Error('Not Found')
    return doc
  })
  return { findByID, req: { payload: { findByID }, user } as never }
}

const hookOf = (group: GroupField, name: string): FieldHook => {
  const field = group.fields.find((f: Field) => 'name' in f && f.name === name) as {
    hooks: { beforeChange: FieldHook[] }
  }
  return field.hooks.beforeChange[0]!
}

const callFile = (hook: FieldHook, args: Record<string, unknown>) =>
  hook({ path: ['block', 'sheet', 'file'], ...args } as never)

/** Payload keeps the human message in data.errors[0].message (what the admin UI shows). */
const fieldMessage = async (promise: unknown): Promise<string> => {
  const error = await (promise as Promise<unknown>).then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ValidationError)
  return (error as ValidationError).data.errors[0]!.message
}

describe('googleDriveSpreadsheetField structure', () => {
  it('builds a group with a picker relationship and (optionally) a computed field', () => {
    const plain = googleDriveSpreadsheetField({ name: 'sheet' })
    expect(plain.type).toBe('group')
    expect(plain.fields.map((f) => ('name' in f ? f.name : ''))).toEqual(['file'])

    const withCompute = googleDriveSpreadsheetField({ name: 'sheet', compute: () => 1, required: true })
    expect(withCompute.fields.map((f) => ('name' in f ? f.name : ''))).toEqual(['file', 'computed'])

    const file = withCompute.fields[0] as {
      admin: { components: { Field: { clientProps: unknown; path: string } } }
      relationTo: string
      required: boolean
    }
    expect(file.relationTo).toBe('google-drive-files')
    expect(file.required).toBe(true)
    expect(file.admin.components.Field).toEqual({
      clientProps: { collectionSlug: 'google-drive-files', mimeTypes: [GOOGLE_SHEET_MIME, XLSX_MIME] },
      path: 'payload-plugin-google-drive/client#SpreadsheetPickerField',
    })
  })

  it('hides the computed value unless asked to show it', () => {
    const hidden = googleDriveSpreadsheetField({ name: 's', compute: () => 1 })
    const shown = googleDriveSpreadsheetField({ name: 's', compute: () => 1, showComputed: true })
    expect((hidden.fields[1] as { admin: { hidden: boolean } }).admin.hidden).toBe(true)
    expect((shown.fields[1] as { admin: { hidden: boolean } }).admin.hidden).toBe(false)
  })

  it('only accepts file types that become xlsx', () => {
    expect(() => googleDriveSpreadsheetField({ name: 's', mimeTypes: ['text/csv'] })).toThrow(/only supports/)
    expect(() => googleDriveSpreadsheetField({ name: 's', mimeTypes: [] })).toThrow(/must not be empty/)
  })
})

describe('chosen file validation (server-side guard)', () => {
  const hook = hookOf(googleDriveSpreadsheetField({ name: 'sheet' }), 'file')

  it('accepts the current user’s own parsed xlsx', async () => {
    const { req } = makeReq(fileDoc())
    expect(await callFile(hook, { previousValue: undefined, req, value: 10 })).toBe(10)
  })

  it('skips all checks when the file did not change', async () => {
    const { findByID, req } = makeReq(fileDoc({ owner: 99 }))
    expect(await callFile(hook, { previousValue: 10, req, value: 10 })).toBe(10)
    expect(await callFile(hook, { previousValue: { id: 10 }, req, value: '10' })).toBe('10')
    expect(findByID).not.toHaveBeenCalled()
  })

  it('does nothing for an empty value', async () => {
    const { findByID, req } = makeReq(fileDoc())
    expect(await callFile(hook, { req, value: null })).toBeNull()
    expect(findByID).not.toHaveBeenCalled()
  })

  it('rejects someone else’s file', async () => {
    const { req } = makeReq(fileDoc({ owner: 2 }), { id: 1 })
    expect(await fieldMessage(callFile(hook, { req, value: 10 }))).toMatch(/imported yourself/)
  })

  it('allows trusted server code (no user)', async () => {
    const { req } = makeReq(fileDoc({ owner: 2 }), null)
    expect(await callFile(hook, { req, value: 10 })).toBe(10)
  })

  it('rejects missing files, wrong types, unparsed and truncated workbooks', async () => {
    const cases: Array<[unknown, RegExp]> = [
      ['missing', /does not exist/],
      [fileDoc({ mimeType: 'text/csv' }), /not an \.xlsx/],
      [fileDoc({ workbook: null }), /could not be read/],
      [fileDoc({ workbook: { ...workbook, truncated: true } }), /too large/],
    ]
    for (const [doc, message] of cases) {
      const { req } = makeReq(doc)
      expect(await fieldMessage(callFile(hook, { req, value: 10 }))).toMatch(message)
    }
  })

  it('reports the error on the field path', async () => {
    const { req } = makeReq('missing')
    const error = await callFile(hook, { req, value: 10 }).catch((e: unknown) => e)
    expect((error as ValidationError).data.errors[0]!.path).toBe('block.sheet.file')
  })
})

describe('compute on save', () => {
  const callCompute = (hook: FieldHook, args: Record<string, unknown>) =>
    hook({ path: ['sheet', 'computed'], ...args } as never)

  const build = (compute: Parameters<typeof googleDriveSpreadsheetField>[0]['compute']) =>
    hookOf(googleDriveSpreadsheetField({ name: 'sheet', compute }), 'computed')

  it('passes the stored workbook and file info to compute() and stores the result', async () => {
    const compute = vi.fn(async ({ workbook: wb }) => ({ rows: wb.sheets[0].rows.length }))
    const { req } = makeReq(fileDoc())

    const result = await callCompute(build(compute), {
      previousSiblingDoc: undefined,
      req,
      siblingData: { file: 10, label: 'x' },
    })

    expect(result).toEqual({ rows: 2 })
    expect(compute).toHaveBeenCalledOnce()
    const args = compute.mock.calls[0]![0]
    expect(args.workbook).toEqual(workbook)
    expect(args.file).toMatchObject({ id: 10, filename: 'prices.xlsx', driveFileId: 'drive-id' })
    expect(args.siblingData).toEqual({ file: 10, label: 'x' })
  })

  it('returns null when no file is chosen', async () => {
    const compute = vi.fn()
    const { req } = makeReq(fileDoc())
    expect(await callCompute(build(compute), { req, siblingData: { file: null } })).toBeNull()
    expect(compute).not.toHaveBeenCalled()
  })

  it('recomputes on every save, so code changes are picked up', async () => {
    const compute = vi.fn(() => 'fresh')
    const { req } = makeReq(fileDoc())
    const result = await callCompute(build(compute), {
      previousSiblingDoc: { computed: 'stale', file: 10 },
      req,
      siblingData: { computed: 'client-sent', file: 10 },
    })
    expect(result).toBe('fresh')
  })

  it('makes the result JSON-safe', async () => {
    const { req } = makeReq(fileDoc())
    const date = new Date('2026-01-01T00:00:00Z')
    const result = await callCompute(build(() => ({ at: date, skip: undefined, n: NaN })), {
      req,
      siblingData: { file: 10 },
    })
    expect(result).toEqual({ at: '2026-01-01T00:00:00.000Z', n: null })
    expect(await callCompute(build(() => undefined), { req, siblingData: { file: 10 } })).toBeNull()
  })

  it('turns errors thrown by compute() into field validation errors', async () => {
    const { req } = makeReq(fileDoc())
    const hook = build(() => {
      throw new Error('Column "price" is missing')
    })
    const error = await callCompute(hook, { req, siblingData: { file: 10 } }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).data.errors[0]).toMatchObject({
      message: 'Column "price" is missing',
      path: 'sheet.computed',
    })
  })

  it('keeps the stored result when the unchanged file is no longer available', async () => {
    const { req } = makeReq('missing')
    const result = await callCompute(build(() => 'x'), {
      previousSiblingDoc: { computed: { total: 5 }, file: 10 },
      req,
      siblingData: { file: 10 },
    })
    expect(result).toEqual({ total: 5 })
  })

  it('fails when a newly chosen file has no data', async () => {
    const { req } = makeReq('missing')
    expect(
      await fieldMessage(
        callCompute(build(() => 'x'), { previousSiblingDoc: undefined, req, siblingData: { file: 10 } }),
      ),
    ).toMatch(/not available/)
  })
})

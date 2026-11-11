import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Payload } from 'payload'
import { getPayload, ValidationError } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { XLSX_MIME } from '../../src/mime.js'
import { getWorkbook, parseWorkbook } from '../../src/workbook.js'
import { buildXlsx } from '../helpers/xlsx.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// One throw-away database per run (Windows keeps SQLite files locked until the process exits).
const dbName = `int-test-${process.pid}.db`
const dbFile = path.join(root, 'dev', dbName)

// Must be set before the dev config is imported.
process.env.DATABASE_URI = `file:./dev/${dbName}`
process.env.PAYLOAD_SECRET = 'int-test-secret'

const removeDbFiles = (file: string) => {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(file + suffix, { force: true })
    } catch {
      // still locked by a live process: ignore
    }
  }
}

const FILES = 'google-drive-files'

let payload: Payload
type User = { collection: 'users'; id: number | string }
let alice: User
let bob: User

const asUser = (user: User) => ({ overrideAccess: false as const, user })

/** What the import endpoint does: create the file record with the parsed workbook in `context`. */
const importFile = async (
  owner: User,
  sheets: Parameters<typeof buildXlsx>[0],
  { parsed = true } = {},
) => {
  const data = buildXlsx(sheets)
  return payload.create({
    collection: FILES,
    context: parsed ? { googleDriveWorkbook: await parseWorkbook(data) } : {},
    data: {},
    depth: 0,
    file: { name: 'prices.xlsx', data, mimetype: XLSX_MIME, size: data.length },
    ...asUser(owner),
  })
}

const pageWith = (file: unknown, extra: Record<string, unknown> = {}) => ({
  title: 'Test page',
  layout: [{ blockType: 'sheetSummary', heading: 'Prices', sheet: { file, ...extra } }],
})

const createdFiles: Array<number | string> = []
const createdPages: Array<number | string> = []

beforeAll(async () => {
  // Clean up databases left behind by earlier runs.
  for (const name of fs.readdirSync(path.join(root, 'dev'))) {
    if (/^int-test-\d+\.db/.test(name)) removeDbFiles(path.join(root, 'dev', name.replace(/(-journal|-wal|-shm)$/, '')))
  }

  const { default: config } = await import('../../dev/payload.config.js')
  payload = await getPayload({ config })

  const users = await payload.find({ collection: 'users', limit: 10, sort: 'email' })
  const byEmail = (email: string) => users.docs.find((u) => u.email === email)!
  alice = { id: byEmail('dev@example.com').id, collection: 'users' }
  bob = { id: byEmail('dev2@example.com').id, collection: 'users' }
})

afterAll(async () => {
  for (const id of createdPages) await payload.delete({ id, collection: 'pages' }).catch(() => {})
  for (const id of createdFiles) await payload.delete({ id, collection: FILES as never }).catch(() => {})
  await payload?.destroy()
  removeDbFiles(dbFile)
})

describe('spreadsheet field inside a block (real Payload instance)', () => {
  it('stores the parsed workbook with the owner-only file record', async () => {
    const file = await importFile(alice, { Prices: [['sku', 'eur'], ['A', 10], ['B', 5.5]] })
    createdFiles.push(file.id)

    expect(file.owner).toBe(alice.id)
    expect((file as { workbook?: unknown }).workbook).toEqual({
      sheets: [{ name: 'Prices', rows: [['sku', 'eur'], ['A', 10], ['B', 5.5]] }],
      truncated: false,
    })
  })

  it('ignores a workbook that a client tries to write', async () => {
    const data = buildXlsx({ S: [['a']] })
    const file = await payload.create({
      collection: FILES,
      data: { workbook: { sheets: [{ name: 'forged', rows: [[999]] }], truncated: false } } as never,
      depth: 0,
      file: { name: 'forged.xlsx', data, mimetype: XLSX_MIME, size: data.length },
      ...asUser(alice),
    })
    createdFiles.push(file.id)
    expect((file as { workbook?: unknown }).workbook).toBeNull()
  })

  it('computes on save, inside a block, from the stored workbook', async () => {
    const file = await importFile(alice, {
      Prices: [['sku', 'eur'], ['A', 10], ['B', 5.5]],
      Other: [[1, 2, 3]],
    })
    createdFiles.push(file.id)

    const page = await payload.create({
      collection: 'pages',
      data: pageWith(file.id),
      depth: 0,
      ...asUser(alice),
    })
    createdPages.push(page.id)

    const block = (page.layout as Array<{ sheet: { computed: unknown; file: unknown } }>)[0]!
    expect(block.sheet.file).toBe(file.id)
    expect(block.sheet.computed).toEqual({
      // Payload de-duplicates file names (prices-1.xlsx, ...) when earlier tests uploaded the same name.
      source: expect.stringMatching(/^prices(-\d+)?\.xlsx$/),
      sheets: [
        { name: 'Prices', numericCells: 2, rowCount: 3, sum: 15.5 },
        { name: 'Other', numericCells: 3, rowCount: 1, sum: 6 },
      ],
      total: 21.5,
    })

    // and it is persisted, not just returned
    const reloaded = await payload.findByID({ id: page.id, collection: 'pages', depth: 0 })
    expect((reloaded.layout as Array<{ sheet: { computed: { total: number } } }>)[0]!.sheet.computed.total).toBe(21.5)
  })

  it('overwrites a forged `computed` value sent by a client', async () => {
    const file = await importFile(alice, { S: [[1, 2]] })
    createdFiles.push(file.id)

    const page = await payload.create({
      collection: 'pages',
      data: pageWith(file.id, { computed: { total: 1_000_000 } }),
      depth: 0,
      ...asUser(alice),
    })
    createdPages.push(page.id)

    const block = (page.layout as Array<{ sheet: { computed: { total: number } } }>)[0]!
    expect(block.sheet.computed.total).toBe(3)
  })

  it('refuses a spreadsheet that belongs to another user', async () => {
    const file = await importFile(alice, { S: [[1]] })
    createdFiles.push(file.id)

    const error = await payload
      .create({ collection: 'pages', data: pageWith(file.id), ...asUser(bob) })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect(JSON.stringify((error as ValidationError).data)).toMatch(/imported yourself/)
  })

  it('refuses a file whose workbook could not be parsed', async () => {
    const file = await importFile(alice, { S: [[1]] }, { parsed: false })
    createdFiles.push(file.id)

    const error = await payload
      .create({ collection: 'pages', data: pageWith(file.id), ...asUser(alice) })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect(JSON.stringify((error as ValidationError).data)).toMatch(/could not be read/)
  })

  it('lets another editor save a page that uses someone else’s file, and keeps the result', async () => {
    const file = await importFile(alice, { S: [[4, 6]] })
    createdFiles.push(file.id)
    const page = await payload.create({ collection: 'pages', data: pageWith(file.id), ...asUser(alice) })
    createdPages.push(page.id)

    // Bob edits only the title; the block (with Alice's file) is re-submitted unchanged.
    const updated = await payload.update({
      id: page.id,
      collection: 'pages',
      depth: 0,
      data: { title: 'Renamed by Bob', layout: [{ ...(page.layout as object[])[0], sheet: { file: file.id } }] } as never,
      ...asUser(bob),
    })

    expect(updated.title).toBe('Renamed by Bob')
    const block = (updated.layout as Array<{ sheet: { computed: { total: number } } }>)[0]!
    expect(block.sheet.computed.total).toBe(10)
  })

  it('does not let a required spreadsheet be emptied', async () => {
    const file = await importFile(alice, { S: [[1]] })
    createdFiles.push(file.id)
    const page = await payload.create({ collection: 'pages', data: pageWith(file.id), ...asUser(alice) })
    createdPages.push(page.id)

    const error = await payload
      .update({ id: page.id, collection: 'pages', data: pageWith(null) as never, ...asUser(alice) })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect(JSON.stringify((error as ValidationError).data)).toMatch(/required|invalid/i)
  })

  it('getWorkbook() exposes the stored data to server code, not the other way round', async () => {
    const file = await importFile(alice, { S: [['x', 2]] })
    createdFiles.push(file.id)

    expect((await getWorkbook(payload, file.id))?.sheets[0]?.rows).toEqual([['x', 2]])
    expect(await getWorkbook(payload, 987654)).toBeNull()

    // Bob cannot read Alice's file record, workbook included.
    const asBob = await payload
      .findByID({ id: file.id, collection: FILES as never, ...asUser(bob) })
      .catch((e: unknown) => e)
    expect(asBob).toBeInstanceOf(Error)
  })
})

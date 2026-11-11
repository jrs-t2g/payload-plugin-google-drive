import { describe, expect, it } from 'vitest'

import { getSheet, getWorkbook, isWorkbook, parseWorkbook, sheetToObjects } from '../src/workbook.js'
import { buildXlsx } from './helpers/xlsx.js'

const sample = () =>
  buildXlsx({
    Cables: [
      ['model', 'length', 'in stock'],
      ['AC-1', 2.5, true],
      ['AC-2', 10, false],
    ],
    Notes: [['hello']],
  })

describe('parseWorkbook', () => {
  it('reads every sheet with typed cells', async () => {
    const workbook = await parseWorkbook(sample())

    expect(workbook.truncated).toBe(false)
    expect(workbook.sheets.map((s) => s.name)).toEqual(['Cables', 'Notes'])
    expect(workbook.sheets[0]!.rows).toEqual([
      ['model', 'length', 'in stock'],
      ['AC-1', 2.5, true],
      ['AC-2', 10, false],
    ])
    expect(isWorkbook(workbook)).toBe(true)
  })

  it('stops at maxCells and flags the workbook as truncated', async () => {
    const workbook = await parseWorkbook(sample(), { maxCells: 5 })
    expect(workbook.truncated).toBe(true)
    expect(workbook.sheets[0]!.rows).toHaveLength(1) // 3 cells fit, the next row would make 6
  })

  it('rejects data that is not an xlsx file', async () => {
    await expect(parseWorkbook(Buffer.from('definitely not a zip file'))).rejects.toThrow()
  })

  it('output survives a JSON round trip (it is stored in a json column)', async () => {
    const workbook = await parseWorkbook(sample())
    expect(JSON.parse(JSON.stringify(workbook))).toEqual(workbook)
  })
})

describe('sheet helpers', () => {
  it('finds sheets by name or index', async () => {
    const workbook = await parseWorkbook(sample())
    expect(getSheet(workbook, 'Notes')?.rows).toEqual([['hello']])
    expect(getSheet(workbook, 0)?.name).toBe('Cables')
    expect(getSheet(workbook, 'Missing')).toBeUndefined()
  })

  it('turns a sheet into objects keyed by the header row', async () => {
    const workbook = await parseWorkbook(sample())
    expect(sheetToObjects(getSheet(workbook)!)).toEqual([
      { 'in stock': true, length: 2.5, model: 'AC-1' },
      { 'in stock': false, length: 10, model: 'AC-2' },
    ])
  })
})

describe('getWorkbook', () => {
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const payloadWith = (doc: unknown) =>
    ({ findByID: async () => doc }) as unknown as Parameters<typeof getWorkbook>[0]

  it('returns the stored workbook of an xlsx file record', async () => {
    const workbook = await parseWorkbook(sample())
    expect(await getWorkbook(payloadWith({ mimeType: XLSX, workbook }), 7)).toEqual(workbook)
    expect(await getWorkbook(payloadWith({ mimeType: XLSX, workbook }), { id: 7 })).toEqual(workbook)
  })

  it('returns null for empty ids, other types and lookup failures', async () => {
    expect(await getWorkbook(payloadWith({}), null)).toBeNull()
    expect(await getWorkbook(payloadWith({ mimeType: 'text/csv', workbook: {} }), 7)).toBeNull()
    const failing = {
      findByID: async () => {
        throw new Error('not found')
      },
    } as unknown as Parameters<typeof getWorkbook>[0]
    expect(await getWorkbook(failing, 7)).toBeNull()
  })
})

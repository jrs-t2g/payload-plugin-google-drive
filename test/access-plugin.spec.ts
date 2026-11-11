import type { CollectionConfig, Config, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { authenticatedCreate, enforceOwner, ownerOnlyAccess } from '../src/access.js'
import { googleDrivePlugin } from '../src/plugin.js'

const valid = { apiKey: 'key', appId: '1234567890', clientId: 'id.apps.googleusercontent.com' }
const req = (user?: { id: number }) => ({ user }) as unknown as PayloadRequest
const baseConfig = { collections: [{ slug: 'users', fields: [] }] } as unknown as Config

describe('access control', () => {
  const run = (access: ReturnType<typeof ownerOnlyAccess>, user?: { id: number }) =>
    access({ req: req(user) } as never)

  it('denies anonymous users', () => {
    expect(run(ownerOnlyAccess(undefined))).toBe(false)
    expect(authenticatedCreate({ req: req() } as never)).toBe(false)
    expect(authenticatedCreate({ req: req({ id: 1 }) } as never)).toBe(true)
  })

  it('restricts to the owner by default, even for admins', () => {
    expect(run(ownerOnlyAccess(undefined), { id: 7 })).toEqual({ owner: { equals: 7 } })
  })

  it('lets isAdmin users through', () => {
    expect(run(ownerOnlyAccess(() => true), { id: 7 })).toBe(true)
  })
})

describe('enforceOwner hook', () => {
  const call = (args: Record<string, unknown>) => enforceOwner(args as never) as Record<string, unknown>

  it('forces the owner on create, ignoring spoofed values', () => {
    const data = call({ data: { owner: 999 }, operation: 'create', req: req({ id: 1 }) })
    expect(data.owner).toBe(1)
  })

  it('never lets the owner change on update', () => {
    expect(
      call({ data: { owner: 999 }, operation: 'update', originalDoc: { owner: 3 }, req: req({ id: 1 }) })
        .owner,
    ).toBe(3)
    expect(
      call({ data: { owner: 999 }, operation: 'update', originalDoc: { owner: { id: 3 } }, req: req({ id: 1 }) })
        .owner,
    ).toBe(3)
  })
})

describe('googleDrivePlugin', () => {
  it('adds the collection, endpoint and admin button', async () => {
    const config = await googleDrivePlugin(valid)(baseConfig)

    const collection = config.collections!.find((c) => c.slug === 'google-drive-files')!
    expect(collection).toBeDefined()
    expect(collection.upload).toBeTruthy()
    expect(collection.fields.find((f) => 'name' in f && f.name === 'owner')).toMatchObject({
      relationTo: 'users',
      required: true,
    })
    expect(collection.admin?.components?.beforeListTable).toHaveLength(1)
    expect(config.endpoints?.map((e) => `${e.method} ${e.path}`)).toEqual([
      'post /google-drive/import',
      'get /google-drive/config',
    ])
    expect(collection.fields.some((f) => 'name' in f && f.name === 'workbook')).toBe(true)
    // existing collections are preserved
    expect(config.collections!.some((c) => c.slug === 'users')).toBe(true)
  })

  it('uses the configured admin user collection as owner relation', async () => {
    const config = await googleDrivePlugin(valid)({
      ...baseConfig,
      admin: { user: 'authors' },
    } as Config)
    const collection = config.collections!.find((c) => c.slug === 'google-drive-files')!
    expect(collection.fields.find((f) => 'name' in f && f.name === 'owner')).toMatchObject({
      relationTo: 'authors',
    })
  })

  it('only accepts the exported mime types in the upload config', async () => {
    const config = await googleDrivePlugin({ ...valid, exportFormat: 'csv' })(baseConfig)
    const collection = config.collections!.find((c) => c.slug === 'google-drive-files')!
    expect(collection.upload).toMatchObject({ mimeTypes: ['text/csv'] })
  })

  it('keeps the collection but drops endpoint and button when disabled', async () => {
    const config = await googleDrivePlugin({ ...valid, disabled: true })(baseConfig)
    const collection = config.collections!.find((c) => c.slug === 'google-drive-files')!
    expect(collection).toBeDefined()
    expect(collection.admin?.components?.beforeListTable).toBeUndefined()
    expect(config.endpoints ?? []).toHaveLength(0)
  })

  it('throws when the slug is already taken', async () => {
    await expect(
      googleDrivePlugin({ ...valid, collectionSlug: 'users' })(baseConfig),
    ).rejects.toThrow(/already exists/)
  })

  it('supports collectionOverride and points the endpoint at the final slug', async () => {
    const config = await googleDrivePlugin({
      ...valid,
      collectionOverride: ({ defaultCollection }) =>
        ({ ...defaultCollection, slug: 'sheets' }) as CollectionConfig,
    })(baseConfig)
    expect(config.collections!.some((c) => c.slug === 'sheets')).toBe(true)
  })
})

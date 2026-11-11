import type { Access, CollectionBeforeValidateHook } from 'payload'

import type { PluginUser } from './types.js'

type IsAdmin = ((user: PluginUser) => boolean) | undefined

/**
 * Owner-only access. Anonymous requests get nothing. Users only see/modify
 * documents whose `owner` is themselves, unless `isAdmin` says otherwise.
 *
 * Payload serves uploaded files through `/api/<slug>/file/<filename>` and
 * applies `read` access to them, so this also protects the file itself.
 */
export const ownerOnlyAccess =
  (isAdmin: IsAdmin): Access =>
  ({ req }) => {
    const user = req.user as PluginUser | null | undefined
    if (!user) return false
    if (isAdmin?.(user)) return true
    return { owner: { equals: user.id } }
  }

/** Any logged-in user may import; the `owner` is forced by the hook below. */
export const authenticatedCreate: Access = ({ req }) => Boolean(req.user)

const idOf = (value: unknown): unknown =>
  value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : value

/**
 * - On create: `owner` is always the authenticated user (clients can't spoof it).
 * - On update: `owner` can never change.
 * Runs in `beforeValidate` so the `required` check on `owner` passes.
 */
export const enforceOwner: CollectionBeforeValidateHook = ({ data, operation, originalDoc, req }) => {
  if (!data) return data

  if (operation === 'create') {
    if (req.user) data.owner = req.user.id
    return data
  }

  if (operation === 'update' && originalDoc) {
    data.owner = idOf(originalDoc.owner)
  }
  return data
}

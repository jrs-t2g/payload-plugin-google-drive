import type { CollectionBeforeChangeHook } from 'payload'

import { WORKBOOK_CONTEXT_KEY } from './constants.js'

/**
 * `workbook` can only be written by the plugin itself (the import endpoint
 * passes it through the Local API `context`), never by a REST/GraphQL client.
 * A freshly uploaded file clears any stale workbook.
 */
export const applyWorkbookFromContext: CollectionBeforeChangeHook = ({
  context,
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data

  const fromContext = (context as Record<string, unknown> | undefined)?.[WORKBOOK_CONTEXT_KEY]

  if (operation === 'create' || req.file) {
    data.workbook = fromContext ?? null
  } else {
    data.workbook = originalDoc?.workbook ?? null
  }
  return data
}

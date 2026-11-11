import type { Endpoint } from 'payload'

import { CONFIG_ENDPOINT_PATH } from '../constants.js'
import type { SanitizedGoogleDriveOptions } from '../types.js'

/**
 * Hands the Picker settings to admin field components. Logged-in users only.
 * (The values are meant for the browser anyway, but there is no reason to
 * serve them to anonymous visitors.)
 */
export const createConfigEndpoint = (options: SanitizedGoogleDriveOptions): Endpoint => ({
  handler: (req) => {
    if (!req.user) return Response.json({ error: 'You must be logged in.' }, { status: 401 })

    return Response.json({
      allowedMimeTypes: options.allowedMimeTypes,
      apiKey: options.apiKey,
      appId: options.appId,
      clientId: options.clientId,
      exportFormat: options.exportFormat,
    })
  },
  method: 'get',
  path: CONFIG_ENDPOINT_PATH,
})

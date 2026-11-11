import type { Config, Plugin } from 'payload'

import { createCollection } from './collection.js'
import { createConfigEndpoint } from './endpoints/config.js'
import { createImportEndpoint } from './endpoints/import.js'
import { sanitizeOptions } from './options.js'
import type { GoogleDrivePluginOptions } from './types.js'

export const googleDrivePlugin =
  (pluginOptions: GoogleDrivePluginOptions): Plugin =>
  async (incomingConfig: Config): Promise<Config> => {
    const options = sanitizeOptions(pluginOptions)

    if (incomingConfig.collections?.some((c) => c.slug === options.collectionSlug)) {
      throw new Error(
        `[payload-plugin-google-drive] A collection with the slug "${options.collectionSlug}" already exists. Use the "collectionSlug" option to pick another one.`,
      )
    }

    const defaultCollection = createCollection({
      options,
      userSlug: incomingConfig.admin?.user ?? 'users',
    })
    const collection = options.collectionOverride
      ? await options.collectionOverride({ defaultCollection })
      : defaultCollection

    // Always register the collection, even when disabled, so the database
    // schema (and migrations) stay stable.
    const config: Config = {
      ...incomingConfig,
      collections: [...(incomingConfig.collections ?? []), collection],
    }

    if (options.disabled) return config

    config.endpoints = [
      ...(incomingConfig.endpoints ?? []),
      createImportEndpoint(options, collection.slug),
      createConfigEndpoint(options),
    ]

    return config
  }

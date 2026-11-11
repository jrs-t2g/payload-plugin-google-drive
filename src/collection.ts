import type { CollectionConfig } from 'payload'

import { authenticatedCreate, enforceOwner, ownerOnlyAccess } from './access.js'
import { PACKAGE_NAME } from './constants.js'
import { getOutputMimeTypes } from './mime.js'
import type { SanitizedGoogleDriveOptions } from './types.js'
import { applyWorkbookFromContext } from './workbookHook.js'

export const createCollection = ({
  options,
  userSlug,
}: {
  options: SanitizedGoogleDriveOptions
  userSlug: string
}): CollectionConfig => {
  const ownerAccess = ownerOnlyAccess(options.isAdmin)

  return {
    slug: options.collectionSlug,
    labels: { plural: 'Google Drive Files', singular: 'Google Drive File' },
    access: {
      create: authenticatedCreate,
      delete: ownerAccess,
      read: ownerAccess,
      update: ownerAccess,
    },
    admin: {
      components: options.disabled
        ? {}
        : {
            beforeListTable: [
              {
                clientProps: {
                  apiKey: options.apiKey,
                  appId: options.appId,
                  buttonLabel: options.buttonLabel,
                  clientId: options.clientId,
                  mimeTypes: options.allowedMimeTypes,
                  multiple: options.multiple,
                },
                path: `${PACKAGE_NAME}/client#GoogleDriveImportButton`,
              },
            ],
          },
      defaultColumns: ['filename', 'driveMimeType', 'owner', 'createdAt'],
      useAsTitle: 'filename',
    },
    fields: [
      {
        name: 'owner',
        type: 'relationship',
        access: { update: () => false },
        admin: { position: 'sidebar', readOnly: true },
        index: true,
        relationTo: userSlug,
        required: true,
      },
      {
        name: 'driveFileId',
        type: 'text',
        admin: { position: 'sidebar', readOnly: true },
        index: true,
        label: 'Google Drive file id',
      },
      {
        name: 'driveMimeType',
        type: 'text',
        admin: { position: 'sidebar', readOnly: true },
        label: 'Original Google Drive type',
      },
      {
        name: 'driveModifiedTime',
        type: 'date',
        admin: { position: 'sidebar', readOnly: true },
        label: 'Last modified in Google Drive',
      },
      {
        // Cell values of imported .xlsx files (see `parseSpreadsheets`). Written
        // only by the plugin; clients can read it only for their own files.
        name: 'workbook',
        type: 'json',
        admin: {
          disableBulkEdit: true,
          disableListColumn: true,
          disableListFilter: true,
          hidden: true,
        },
      },
    ],
    hooks: {
      beforeChange: [applyWorkbookFromContext],
      beforeValidate: [enforceOwner],
    },
    upload: {
      // Only accept what we actually produce. Payload also verifies the real
      // file content against this list, not just the declared mime type.
      mimeTypes: getOutputMimeTypes(options.allowedMimeTypes, options.exportFormat),
      ...(options.staticDir ? { staticDir: options.staticDir } : {}),
    },
  }
}

export const PACKAGE_NAME = 'payload-plugin-google-drive'

export const DEFAULT_COLLECTION_SLUG = 'google-drive-files'
export const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024
export const DEFAULT_BUTTON_LABEL = 'Import from Google Drive'
export const DEFAULT_MAX_PARSED_CELLS = 250_000

/** Endpoint paths, mounted under the Payload API route (`/api` by default). */
export const IMPORT_ENDPOINT_PATH = '/google-drive/import'
export const CONFIG_ENDPOINT_PATH = '/google-drive/config'

/** Key used to hand the parsed workbook from the import endpoint to the collection hook. */
export const WORKBOOK_CONTEXT_KEY = 'googleDriveWorkbook'

/** Non-sensitive scope: the app only sees files the user explicitly picks. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'

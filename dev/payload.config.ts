import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import dotenv from 'dotenv'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { googleDrivePlugin } from '../src/index.js'
import { SheetSummary } from './blocks/sheetSummary.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Load dev/.env no matter whether Next.js or the Payload CLI runs this file.
dotenv.config({ path: path.resolve(dirname, '.env') })

const { GOOGLE_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_PROJECT_NUMBER } = process.env
const hasGoogleCredentials = Boolean(GOOGLE_API_KEY && GOOGLE_CLIENT_ID && GOOGLE_PROJECT_NUMBER)

if (!hasGoogleCredentials) {
  // eslint-disable-next-line no-console
  console.warn(
    '[dev] GOOGLE_CLIENT_ID / GOOGLE_API_KEY / GOOGLE_PROJECT_NUMBER are not set in dev/.env. ' +
      'The plugin is running in "disabled" mode (no import button).',
  )
}

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
      importMapFile: path.resolve(dirname, 'app/(payload)/admin/importMap.js'),
    },
    user: 'users',
  },
  collections: [
    {
      slug: 'users',
      auth: true,
      fields: [],
    },
    {
      // Public like a website's pages, but only logged-in users may edit.
      slug: 'pages',
      access: {
        create: ({ req }) => Boolean(req.user),
        delete: ({ req }) => Boolean(req.user),
        read: () => true,
        update: ({ req }) => Boolean(req.user),
      },
      admin: { useAsTitle: 'title' },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'layout', type: 'blocks', blocks: [SheetSummary] },
      ],
    },
  ],
  db: sqliteAdapter({
    client: { url: process.env.DATABASE_URI || 'file:./dev/dev.db' },
  }),
  editor: lexicalEditor(),
  // Two users are seeded so you can verify that files are owner-only.
  onInit: async (payload) => {
    const { totalDocs } = await payload.count({ collection: 'users' })
    if (totalDocs > 0) return

    for (const email of ['dev@example.com', 'dev2@example.com']) {
      await payload.create({ collection: 'users', data: { email, password: 'test' } })
    }
    payload.logger.info('Seeded users: dev@example.com and dev2@example.com (password: test)')
  },
  plugins: [
    googleDrivePlugin({
      apiKey: GOOGLE_API_KEY ?? '',
      appId: GOOGLE_PROJECT_NUMBER ?? '',
      clientId: GOOGLE_CLIENT_ID ?? '',
      disabled: !hasGoogleCredentials,
      // Also accept Excel and CSV files so the dev instance exercises every path.
      allowedMimeTypes: [
        'application/vnd.google-apps.spreadsheet',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
      ],
      staticDir: path.resolve(dirname, 'media/google-drive-files'),
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || 'dev-only-secret-change-me',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})

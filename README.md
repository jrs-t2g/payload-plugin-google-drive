# payload-plugin-google-drive

A [Payload CMS](https://payloadcms.com) 3.x plugin that lets authors **pick spreadsheets from their own Google Drive** with Google's own file chooser (the [Google Picker](https://developers.google.com/drive/picker)) and **import a copy into Payload**. Imported files are stored with Payload's normal upload storage and are **readable only by the user who imported them**.

- Uses the non-sensitive `drive.file` scope: the app can only touch files the user explicitly picks. No Google app verification needed.
- Spreadsheets only by default (Google Sheets). `.xlsx`, `.csv`, `.ods`, `.tsv` can be allowed too.
- No refresh tokens, no stored Google credentials. A short-lived access token lives in the browser and is used for a single download.
- Owner-only access on read, update and delete. File URLs are protected too, because Payload applies `read` access to `/api/<slug>/file/<name>`.

> Not affiliated with or endorsed by Google. "Google Drive" and "Google Sheets" are trademarks of Google LLC.

## Install

```bash
pnpm add payload-plugin-google-drive
```

Peer dependencies: `payload` 3.x, `@payloadcms/ui` 3.x, `next`, `react`.

## Usage

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { googleDrivePlugin } from 'payload-plugin-google-drive'

export default buildConfig({
  // ...
  plugins: [
    googleDrivePlugin({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      apiKey: process.env.GOOGLE_API_KEY!,
      appId: process.env.GOOGLE_PROJECT_NUMBER!,
    }),
  ],
})
```

Then run:

```bash
pnpm payload generate:importmap   # registers the admin button
pnpm payload generate:types
```

A new **Google Drive Files** collection appears in the admin panel with an **Import from Google Drive** button above its list.

## Google Cloud setup (one time)

1. Create a project at <https://console.cloud.google.com/>. Note the **project number** (Dashboard → Project info). This is `appId`.
2. **APIs & Services → Library**: enable **Google Picker API** and **Google Drive API**.
3. **OAuth consent screen**: choose *External*, fill in the basics, and add the scope `.../auth/drive.file`. While the app is in *Testing*, add your authors as test users. Because `drive.file` is non-sensitive you can publish the app without Google's verification.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Under *Authorized JavaScript origins* add your admin origin (e.g. `http://localhost:3000` and `https://cms.example.com`). Copy the client id → `clientId`.
5. **Credentials → Create credentials → API key**. Restrict it to the *Google Picker API* and to your admin origin as an HTTP referrer. → `apiKey`.

```env
GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
GOOGLE_API_KEY=AIza...
GOOGLE_PROJECT_NUMBER=1234567890
```

`clientId`, `apiKey` and `appId` are sent to the browser. That is how the Picker works, and why the API key must be restricted.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `clientId` | `string` | required | OAuth *Web application* client id. |
| `apiKey` | `string` | required | API key restricted to the Picker API. |
| `appId` | `string` | required | Numeric Cloud **project number**. |
| `allowedMimeTypes` | `string[]` | Google Sheets | Any of Google Sheets (`application/vnd.google-apps.spreadsheet`), xlsx, csv, ods, tsv. |
| `exportFormat` | `'xlsx' \| 'csv' \| 'tsv' \| 'ods' \| 'pdf'` | `'xlsx'` | Format Google Sheets are exported to. `csv`/`tsv` only contain the first sheet. |
| `collectionSlug` | `string` | `'google-drive-files'` | Slug of the generated upload collection. |
| `maxFileSize` | `number` (bytes) | 25 MB | Per-file limit, enforced while streaming. Google exports are capped at 10 MB by Google. |
| `multiple` | `boolean` | `true` | Allow selecting several files at once. |
| `isAdmin` | `(user) => boolean` | none | Users for whom this returns `true` can read/update/delete everyone's files. By default **even admins cannot**. |
| `staticDir` | `string` | Payload default | Where files are stored. Keep it outside your public folder. |
| `buttonLabel` | `string` | `'Import from Google Drive'` | Label of the admin button. |
| `collectionOverride` | `({ defaultCollection }) => CollectionConfig` | none | Customise the generated collection (async allowed). |
| `parseSpreadsheets` | `boolean` | `true` | Parse imported `.xlsx` files on the server and store their cell values (needed by the block field below). |
| `maxParsedCells` | `number` | 250 000 | Cells stored per workbook. Larger files are flagged `truncated` and rejected by the field. |
| `disabled` | `boolean` | `false` | Keep the collection in the schema but remove the endpoints and button. |

## Spreadsheet field for blocks

`googleDriveSpreadsheetField()` is a field you drop into any block or collection. The author picks an `.xlsx` file (or a Google Sheet) from their Drive; the file is imported into Payload, its cells are read on the server, and an optional `compute()` callback turns them into a result that is stored with the document.

```ts
import type { Block } from 'payload'
import { googleDriveSpreadsheetField } from 'payload-plugin-google-drive'

export const PriceTable: Block = {
  slug: 'priceTable',
  fields: [
    { name: 'heading', type: 'text' },
    googleDriveSpreadsheetField({
      name: 'sheet',
      label: 'Price list',
      required: true,
      compute: ({ workbook }) => {
        const rows = workbook.sheets[0]!.rows.slice(1) // skip the header row
        return {
          products: rows.length,
          cheapest: Math.min(...rows.map((row) => Number(row[1]))),
        }
      },
    }),
  ],
}
```

The field is a `group` named `sheet` with two sub-fields:

| Sub-field | What it holds |
| --- | --- |
| `file` | Relationship to the imported file in the owner-only collection. |
| `computed` | The JSON returned by `compute()` (only exists if you pass `compute`). Hidden in the admin unless `showComputed: true`. |

**The raw spreadsheet stays private.** The page only stores the *result*. Visitors (and other editors) can't read the file itself, because it lives in the owner-only collection.

### How the computation works

- When a file is imported, the server parses it once and stores the cell values (JSON) on the file record. This works with any storage adapter, because the raw file is never re-read.
- `compute()` runs **on the server every time the document is saved**, so changes to your code are picked up on the next save.
- It receives `{ workbook, file, siblingData, req }`. `workbook.sheets[i].rows` is a 2-D array of values; dates are ISO strings and formulas are their cached results.
- Throw an `Error` inside `compute()` to reject the save. The message is shown on the field, e.g. `throw new Error('Column "price" is missing')`.
- The returned value must be JSON-serialisable.

Helpers: `getSheet(workbook, nameOrIndex)` and `sheetToObjects(sheet)` (rows to objects keyed by the header row).

### Using the data without `compute`

In a React Server Component (or any server code) you can read the workbook yourself, for example to compute at render time:

```ts
import { getWorkbook, getSheet, sheetToObjects } from 'payload-plugin-google-drive'

const workbook = await getWorkbook(payload, block.sheet.file) // file can be an id or a populated doc
const products = workbook ? sheetToObjects(getSheet(workbook)!) : []
```

`getWorkbook` bypasses access control on purpose, so only pass it ids that come from your own documents, never from user input.

### What the field enforces on the server

- An editor can only attach a spreadsheet **they imported themselves**. Attaching someone else's file id through the API is rejected.
- The file must be an `.xlsx`, must have been parsed, and must not be truncated.
- A `computed` value sent by a client is ignored and always recomputed.
- Another editor can still save a page that uses your file. The check only applies when the file changes.

### Requirements

- Keep `exportFormat: 'xlsx'` (the default) so Google Sheets are stored as `.xlsx`.
- To accept uploaded `.xlsx` files from Drive (not just Google Sheets), add the xlsx mime type to `allowedMimeTypes` (see above). The field's Picker only offers types the plugin allows.
- If you change `collectionSlug`, pass the same value to the field: `googleDriveSpreadsheetField({ collectionSlug: '...' })`.
- Run `generate:importmap` and `generate:types` after adding the field.

### Allowing Excel and CSV files

```ts
import { googleDrivePlugin } from 'payload-plugin-google-drive'

googleDrivePlugin({
  // ...credentials
  allowedMimeTypes: [
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'text/csv',
  ],
})
```

## How it works

1. The admin button loads Google Identity Services and the Picker, and requests a short-lived access token (`drive.file`) in a popup.
2. The author picks spreadsheet(s) in Google's own UI.
3. The browser calls `POST /api/google-drive/import` with the file id and the access token.
4. The server (authenticated Payload user required):
   - reads the file's metadata from Drive and checks its type against `allowedMimeTypes` (the Picker filter is not trusted);
   - downloads or exports it, aborting past `maxFileSize`;
   - creates the document through the Local API with `overrideAccess: false`, setting `owner` to the current user.
5. The access token is never stored or logged.

## Security model

- `owner` is forced to the authenticated user on create and can never change.
- `access.read/update/delete` return `{ owner: { equals: user.id } }`, so the REST/GraphQL APIs, admin lists, and file URLs all respect it.
- The upload collection only accepts the mime types the plugin produces. Payload also checks the actual file content against this list.
- If you override `collectionOverride`, keep the access functions, otherwise files may become visible to others.

## Limitations

- Each author signs in to Google in a popup when the token expires (about one hour).
- Files are copies. Later changes in Drive are not synced; import again to refresh.
- Very large files on serverless hosts may hit the platform's request time or body limits.
- `.xlsx` files are expanded in memory when parsed. Keep `maxFileSize` modest, as for any upload feature that accepts zip-based formats.
- Only cell *values* are read: formulas show the result cached in the file, and charts, images and styling are ignored.
- The collection has the label "Google Drive Files". Use `collectionOverride` to rename it or move it to an admin group.

## Development

```bash
pnpm install
pnpm test        # unit tests (vitest)
pnpm test:int    # integration tests on a real Payload + SQLite instance (dev/payload.config.ts)
pnpm lint:types  # tsc --noEmit
pnpm build       # emits ./dist
```

### Standalone dev instance

`dev/` is a small Payload + Next.js app that loads the plugin straight from `src/` (SQLite, no external services):

```bash
pnpm dev                        # http://localhost:3000/admin
```

- **Login:** two users are seeded on first start: `dev@example.com` and `dev2@example.com`, both with password `test`. Use both to check that files are owner-only.
- **Google credentials (optional):** copy `dev/.env.example` to `dev/.env` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY` and `GOOGLE_PROJECT_NUMBER`. Add `http://localhost:3000` to the OAuth client's authorized JavaScript origins. Without credentials the plugin runs in `disabled` mode: the collection and its access rules exist, but there is no import button or endpoint.
- **Import map:** after changing admin components in the plugin, run `pnpm dev:generate-importmap` (with credentials set, otherwise the button is left out).
- **Reset:** delete `dev/dev.db` and `dev/media` to start from scratch.
- **Why `--webpack`:** the source uses `./file.js` imports for `.ts` files (needed for the Node ESM build). Turbopack can't alias those extensions, webpack can.

Other scripts: `pnpm dev:types` (type-check the dev app), `pnpm dev:generate-types`, `pnpm dev:payload <command>` (Payload CLI), `pnpm dev:build`.

### Trying the built package in another Payload project

Pack it and install the tarball (avoids duplicate `react`/`payload` copies that `pnpm link` can cause):

```bash
pnpm build && pnpm pack
# in your Payload project:
pnpm add ../payload-plugin-google-drive/payload-plugin-google-drive-0.1.0.tgz
pnpm payload generate:importmap
```

## Publishing

```bash
npm login
npm publish --access public   # `prepublishOnly` type-checks, tests and builds first
```

Add the `payload-plugin` topic to the GitHub repository so the community can find it.

## License

[MIT](./LICENSE)

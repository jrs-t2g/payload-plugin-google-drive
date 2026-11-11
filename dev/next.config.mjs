import { withPayload } from '@payloadcms/next/withPayload'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '..')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't let `next dev` write AGENTS.md / CLAUDE.md into dev/.
  agentRules: false,
  reactStrictMode: true,
  redirects: async () => [{ destination: '/admin', permanent: false, source: '/' }],
  // Needed on Windows until Next.js fixes Turbopack Sass resolution.
  sassOptions: {
    loadPaths: [path.resolve(repoRoot, 'node_modules/@payloadcms/ui/dist/scss/')],
  },
  // The plugin source lives one level up (../src), so Turbopack must see the repo root.
  turbopack: { root: repoRoot },
  webpack: (webpackConfig) => {
    // The plugin source imports './file.js' for './file.ts'. Turbopack can't
    // alias extensions, so the dev scripts run Next with `--webpack`.
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })

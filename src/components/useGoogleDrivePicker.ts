'use client'

import { toast, useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { DRIVE_FILE_SCOPE, IMPORT_ENDPOINT_PATH } from '../constants.js'

export type PickerConfig = {
  apiKey: string
  appId: string
  clientId: string
  mimeTypes: string[]
  multiple: boolean
}

export type ImportedFile = {
  filename: string
  id: number | string
  /** Name of the file in Google Drive. */
  name: string
}

// Google's scripts attach `gapi` and `google` to `window`; they ship no usable types.
/* eslint-disable @typescript-eslint/no-explicit-any */
const googleGlobals = () => window as unknown as { gapi: any; google: any }

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const GAPI_SRC = 'https://apis.google.com/js/api.js'

const loadScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing?.dataset.loaded === 'true') return resolve()

    const script = existing ?? document.createElement('script')
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true'
      resolve()
    })
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)))
    if (!existing) {
      script.src = src
      script.async = true
      document.head.appendChild(script)
    }
  })

let apisPromise: Promise<void> | null = null

/** Load Google Identity Services + the Picker library once per page. */
const loadGoogleApis = (): Promise<void> => {
  apisPromise ??= (async () => {
    await Promise.all([loadScript(GIS_SRC), loadScript(GAPI_SRC)])
    await new Promise<void>((resolve, reject) => {
      googleGlobals().gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('Could not load the Google Picker.')),
      })
    })
  })().catch((error) => {
    apisPromise = null
    throw error
  })
  return apisPromise
}

type PickedDoc = { id: string; name: string }

/**
 * Shared Google Picker + import flow used by the list button and the
 * spreadsheet field. Pass `null` until the config is known.
 *
 * `pickAndImport()` opens Google sign-in/Picker and imports every picked file
 * through the plugin endpoint. It must be called straight from a click handler.
 */
export const useGoogleDrivePicker = (pickerConfig: null | PickerConfig) => {
  const { config } = useConfig()

  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  const tokenClientRef = useRef<any>(null)
  const tokenRef = useRef<{ expiresAt: number; value: string } | null>(null)
  const pendingRef = useRef<{ reject: (e: Error) => void; resolve: (t: string) => void } | null>(null)

  const clientId = pickerConfig?.clientId

  // Preload everything so the OAuth popup can open straight from the click
  // (browsers block popups that are opened after an `await`).
  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    loadGoogleApis()
      .then(() => {
        if (cancelled) return
        tokenClientRef.current = googleGlobals().google.accounts.oauth2.initTokenClient({
          callback: (response: any) => {
            const pending = pendingRef.current
            pendingRef.current = null
            if (response.error) {
              pending?.reject(new Error(response.error_description || response.error))
              return
            }
            tokenRef.current = {
              expiresAt: Date.now() + (Number(response.expires_in) - 60) * 1000,
              value: response.access_token,
            }
            pending?.resolve(response.access_token)
          },
          client_id: clientId,
          error_callback: (error: any) => {
            const pending = pendingRef.current
            pendingRef.current = null
            pending?.reject(
              new Error(
                error?.type === 'popup_closed'
                  ? 'The Google sign-in window was closed.'
                  : (error?.message ?? 'Google sign-in failed.'),
              ),
            )
          },
          scope: DRIVE_FILE_SCOPE,
        })
        setReady(true)
      })
      .catch((error: Error) => toast.error(error.message))

    return () => {
      cancelled = true
    }
  }, [clientId])

  const requestToken = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        const cached = tokenRef.current
        if (cached && cached.expiresAt > Date.now()) return resolve(cached.value)
        pendingRef.current = { reject, resolve }
        tokenClientRef.current.requestAccessToken({ prompt: '' })
      }),
    [],
  )

  const pickFiles = useCallback(
    (token: string, cfg: PickerConfig) =>
      new Promise<PickedDoc[]>((resolve) => {
        const { google } = googleGlobals()

        const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
          .setMimeTypes(cfg.mimeTypes.join(','))
          .setIncludeFolders(true)
          .setSelectFolderEnabled(false)

        const builder = new google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(token)
          .setDeveloperKey(cfg.apiKey)
          .setAppId(cfg.appId)
          .setOrigin(window.location.origin)
          .setCallback((data: any) => {
            if (data.action === google.picker.Action.PICKED) {
              resolve(data.docs.map((d: any) => ({ id: d.id, name: d.name })))
            } else if (data.action === google.picker.Action.CANCEL) {
              resolve([])
            }
          })

        if (cfg.multiple) builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED)

        builder.build().setVisible(true)
      }),
    [],
  )

  const pickAndImport = useCallback(async (): Promise<ImportedFile[]> => {
    if (!pickerConfig || !tokenClientRef.current) return []

    setBusy(true)
    try {
      const token = await requestToken()
      const docs = await pickFiles(token, pickerConfig)
      if (docs.length === 0) return []

      const url = formatAdminURL({
        apiRoute: config.routes.api,
        path: IMPORT_ENDPOINT_PATH,
        serverURL: config.serverURL,
      })

      const imported: ImportedFile[] = []
      for (const doc of docs) {
        const response = await fetch(url, {
          body: JSON.stringify({ accessToken: token, fileId: doc.id }),
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        const result = (await response.json().catch(() => null)) as {
          doc?: { filename: string; id: number | string }
          error?: string
        } | null

        if (!response.ok || !result?.doc) {
          toast.error(`${doc.name}: ${result?.error ?? response.statusText}`)
          continue
        }
        imported.push({ id: result.doc.id, name: doc.name, filename: result.doc.filename })
      }
      return imported
    } catch (error) {
      toast.error((error as Error).message)
      return []
    } finally {
      setBusy(false)
    }
  }, [config.routes.api, config.serverURL, pickFiles, pickerConfig, requestToken])

  return { busy, pickAndImport, ready }
}

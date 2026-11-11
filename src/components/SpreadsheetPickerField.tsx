'use client'

import {
  Button,
  FieldDescription,
  FieldError,
  FieldLabel,
  RelationshipField,
  useConfig,
  useField,
} from '@payloadcms/ui'
import type { SingleRelationshipFieldClient } from 'payload'
import { formatAdminURL } from 'payload/shared'
import React, { useEffect, useMemo, useState } from 'react'

import { CONFIG_ENDPOINT_PATH } from '../constants.js'
import { type PickerConfig, useGoogleDrivePicker } from './useGoogleDrivePicker.js'

export type SpreadsheetPickerFieldProps = {
  /** Slug of the plugin's upload collection. */
  collectionSlug: string
  field?: SingleRelationshipFieldClient
  /** Mime types this field accepts (intersected with the plugin's allowed types). */
  mimeTypes: string[]
  path: string
  readOnly?: boolean
}

type FileId = null | number | string

export const SpreadsheetPickerField: React.FC<SpreadsheetPickerFieldProps> = ({
  collectionSlug,
  field,
  mimeTypes,
  path,
  readOnly,
}) => {
  const { config } = useConfig()
  const { errorMessage, setValue, showError, value } = useField<FileId>({ path })

  const [pickerConfig, setPickerConfig] = useState<null | PickerConfig>(null)
  const [setupError, setSetupError] = useState<null | string>(null)
  const [filename, setFilename] = useState<null | string>(null)

  const mimeTypesKey = mimeTypes.join(',')

  // 1. Ask the server for the Picker credentials (logged-in users only).
  useEffect(() => {
    let cancelled = false
    const url = formatAdminURL({
      apiRoute: config.routes.api,
      path: CONFIG_ENDPOINT_PATH,
      serverURL: config.serverURL,
    })

    fetch(url, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('The Google Drive plugin is not enabled on this server.')
        return (await response.json()) as {
          allowedMimeTypes: string[]
          apiKey: string
          appId: string
          clientId: string
        }
      })
      .then((server) => {
        if (cancelled) return
        const accepted = mimeTypesKey.split(',').filter((m) => server.allowedMimeTypes.includes(m))
        if (accepted.length === 0) {
          setSetupError(
            'None of the file types for this field are enabled in the plugin ("allowedMimeTypes").',
          )
          return
        }
        setPickerConfig({
          apiKey: server.apiKey,
          appId: server.appId,
          clientId: server.clientId,
          mimeTypes: accepted,
          multiple: false,
        })
      })
      .catch((error: Error) => !cancelled && setSetupError(error.message))

    return () => {
      cancelled = true
    }
  }, [config.routes.api, config.serverURL, mimeTypesKey])

  // 2. Show the name of the currently selected file.
  useEffect(() => {
    if (value === null || value === undefined || value === '') {
      setFilename(null)
      return
    }
    let cancelled = false
    const url = formatAdminURL({
      apiRoute: config.routes.api,
      path: `/${collectionSlug}/${value}?depth=0`,
      serverURL: config.serverURL,
    })

    fetch(url, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((doc: { filename?: string } | null) => {
        if (!cancelled) setFilename(doc?.filename ?? null)
      })
      .catch(() => !cancelled && setFilename(null))

    return () => {
      cancelled = true
    }
  }, [collectionSlug, config.routes.api, config.serverURL, value])

  const { busy, pickAndImport, ready } = useGoogleDrivePicker(pickerConfig)

  const hasValue = value !== null && value !== undefined && value !== ''
  const fileURL = useMemo(
    () =>
      hasValue
        ? formatAdminURL({
            adminRoute: config.routes.admin,
            path: `/collections/${collectionSlug}/${value}`,
            serverURL: config.serverURL,
          })
        : null,
    [collectionSlug, config.routes.admin, config.serverURL, hasValue, value],
  )

  const handleChoose = async () => {
    const [file] = await pickAndImport()
    if (file) {
      setFilename(file.filename)
      setValue(file.id)
    }
  }

  const payloadRelationshipField = useMemo((): SingleRelationshipFieldClient => {
    if (field?.relationTo) return field
    return {
      name: 'file',
      relationTo: collectionSlug,
      required: field?.required,
      type: 'relationship',
    }
  }, [collectionSlug, field])

  const payloadPickerField = useMemo(
    (): SingleRelationshipFieldClient => ({
      ...payloadRelationshipField,
      admin: {
        ...payloadRelationshipField.admin,
        description:
          'Pick a spreadsheet you already imported (Google Drive Files). Only your own files are listed.',
      },
      label: 'Choose from Payload',
    }),
    [payloadRelationshipField],
  )

  return (
    <div className={`field-type${showError ? ' error' : ''}`} style={{ marginBottom: 'var(--base)' }}>
      <FieldLabel label={field?.label as never} path={path} required={field?.required} />

      <p
        style={{
          color: 'var(--theme-elevation-600)',
          fontSize: '13px',
          marginBottom: 'calc(var(--base) / 2)',
          marginTop: 0,
        }}
      >
        Import a new file from Google Drive, or choose an existing .xlsx below.
      </p>

      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--base) / 2)' }}>
        <Button
          buttonStyle="secondary"
          disabled={readOnly || !ready || busy || Boolean(setupError)}
          onClick={handleChoose}
          size="medium"
        >
          {busy ? 'Working…' : hasValue ? 'Replace from Google Drive' : 'Import from Google Drive'}
        </Button>

        {hasValue && !readOnly && (
          <Button buttonStyle="subtle" disabled={busy} onClick={() => setValue(null)} size="medium">
            Remove
          </Button>
        )}

        {hasValue && (
          <span>
            {fileURL ? (
              <a href={fileURL} rel="noreferrer" target="_blank">
                {filename ?? `File #${value}`}
              </a>
            ) : (
              (filename ?? `File #${value}`)
            )}
          </span>
        )}
      </div>

      {setupError && (
        <p style={{ color: 'var(--theme-warning-500)', marginTop: 'calc(var(--base) / 2)' }}>
          Google Drive import: {setupError} You can still choose a file from Payload below.
        </p>
      )}

      <div style={{ marginTop: 'var(--base)' }}>
        <RelationshipField field={payloadPickerField} path={path} readOnly={readOnly} />
      </div>

      <FieldError message={errorMessage} path={path} showError={showError} />
      <FieldDescription description={field?.admin?.description as never} path={path} />
    </div>
  )
}

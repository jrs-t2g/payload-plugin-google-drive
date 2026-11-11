'use client'

import { Button, toast } from '@payloadcms/ui'
import { useRouter } from 'next/navigation.js'
import React, { useMemo } from 'react'

import { useGoogleDrivePicker } from './useGoogleDrivePicker.js'

export type GoogleDriveImportButtonProps = {
  apiKey: string
  appId: string
  buttonLabel: string
  clientId: string
  mimeTypes: string[]
  multiple: boolean
}

export const GoogleDriveImportButton: React.FC<GoogleDriveImportButtonProps> = ({
  apiKey,
  appId,
  buttonLabel,
  clientId,
  mimeTypes,
  multiple,
}) => {
  const router = useRouter()

  const mimeTypesKey = mimeTypes.join(',')
  const pickerConfig = useMemo(
    () => ({ apiKey, appId, clientId, mimeTypes: mimeTypesKey.split(','), multiple }),
    [apiKey, appId, clientId, mimeTypesKey, multiple],
  )
  const { busy, pickAndImport, ready } = useGoogleDrivePicker(pickerConfig)

  const handleClick = async () => {
    const imported = await pickAndImport()
    if (imported.length > 0) {
      toast.success(imported.length === 1 ? 'File imported.' : `${imported.length} files imported.`)
      router.refresh()
    }
  }

  return (
    <div style={{ marginBottom: 'var(--base)' }}>
      <Button buttonStyle="secondary" disabled={!ready || busy} onClick={handleClick} size="medium">
        {busy ? 'Working…' : buttonLabel}
      </Button>
    </div>
  )
}

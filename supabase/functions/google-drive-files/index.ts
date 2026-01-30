// Supabase Edge Function: Google Drive Files
// List files and folders, create subfolders for loan file browser
//
// Deployment:
//   supabase functions deploy google-drive-files
//
// Actions:
//   - list: List files and folders in a folder
//   - list-recursive: Recursively list all files (for flat view)
//   - create-folder: Create a new subfolder
//   - upload: Upload a file to a specific folder

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { refreshTokenIfNeeded, getUserTokens } from '../_shared/tokenManagement.ts'
import { jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts'

interface DriveItem {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
  webViewLink?: string
  isFolder: boolean
  parentPath?: string
}

// Get folder metadata to determine if it's in a shared drive
async function getFolderDriveId(accessToken: string, folderId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=driveId&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const data = await response.json()
    if (data.error) {
      console.log('[GoogleDriveFiles] Could not get folder driveId:', data.error.message)
      return null
    }
    return data.driveId || null
  } catch (e) {
    console.log('[GoogleDriveFiles] Error getting folder driveId:', e)
    return null
  }
}

// List files and folders in a parent folder
async function listFilesAndFolders(
  accessToken: string,
  folderId: string,
  driveId?: string
): Promise<{ items: DriveItem[], nextPageToken?: string }> {
  // If no driveId provided, try to detect it from the folder
  let effectiveDriveId = driveId
  if (!effectiveDriveId) {
    effectiveDriveId = await getFolderDriveId(accessToken, folderId) || undefined
    if (effectiveDriveId) {
      console.log('[GoogleDriveFiles] Detected shared drive:', effectiveDriveId)
    }
  }

  const query = `'${folderId}' in parents and trashed=false`
  const fields = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)'

  let apiUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&pageSize=100&orderBy=folder,name`

  // For shared drives, need additional parameters
  if (effectiveDriveId && effectiveDriveId !== 'root') {
    apiUrl += `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${effectiveDriveId}`
  } else {
    apiUrl += `&supportsAllDrives=true&includeItemsFromAllDrives=true`
  }

  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  const data = await response.json()

  if (data.error) {
    throw new Error(data.error.message)
  }

  const items: DriveItem[] = (data.files || []).map((file: any) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
    isFolder: file.mimeType === 'application/vnd.google-apps.folder'
  }))

  return {
    items,
    nextPageToken: data.nextPageToken
  }
}

// Recursively list all files (for flat view)
async function listFilesRecursive(
  accessToken: string,
  folderId: string,
  driveId?: string,
  parentPath: string = ''
): Promise<DriveItem[]> {
  // Detect driveId on first call if not provided
  let effectiveDriveId = driveId
  if (!effectiveDriveId && !parentPath) {
    effectiveDriveId = await getFolderDriveId(accessToken, folderId) || undefined
  }

  const result: DriveItem[] = []
  const { items } = await listFilesAndFolders(accessToken, folderId, effectiveDriveId)

  for (const item of items) {
    if (item.isFolder) {
      // Recurse into subfolder, passing the driveId
      const subItems = await listFilesRecursive(
        accessToken,
        item.id,
        effectiveDriveId,
        parentPath ? `${parentPath}/${item.name}` : item.name
      )
      result.push(...subItems)
    } else {
      // Add file with parent path
      result.push({
        ...item,
        parentPath: parentPath || '/'
      })
    }
  }

  return result
}

// Create a new folder
async function createFolder(
  accessToken: string,
  parentId: string,
  name: string,
  driveId?: string
): Promise<{ id: string, name: string, webViewLink: string }> {
  const metadata: any = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  }

  const response = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    }
  )

  const data = await response.json()

  if (data.error) {
    throw new Error(data.error.message)
  }

  return {
    id: data.id,
    name: data.name,
    webViewLink: data.webViewLink
  }
}

// Upload a file to a specific folder
async function uploadFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  base64Content: string,
  mimeType: string
): Promise<{ id: string, name: string, webViewLink: string }> {
  const boundary = '-------314159265358979323846'
  const metadata = {
    name: fileName,
    parents: [folderId]
  }

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Content}\r\n` +
    `--${boundary}--`

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  )

  const data = await response.json()

  if (data.error) {
    throw new Error(data.error.message)
  }

  return {
    id: data.id,
    name: data.name,
    webViewLink: data.webViewLink
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleCors()
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID')!
    const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')!
    const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')!

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Verify user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return errorResponse('Missing authorization header', 401)
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      return errorResponse('Invalid user token', 401)
    }

    // Get tokens
    const tokenData = await getUserTokens(supabaseAdmin, user.id)

    if (!tokenData) {
      return errorResponse('Google Drive not connected', 400)
    }

    const accessToken = await refreshTokenIfNeeded({
      supabaseAdmin,
      userId: user.id,
      tokenData,
      encryptionKey,
      googleClientId,
      googleClientSecret
    })

    // Handle GET requests (list actions)
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const action = url.searchParams.get('action') || 'list'
      const folderId = url.searchParams.get('folderId')
      const driveId = url.searchParams.get('driveId')

      if (!folderId) {
        return errorResponse('Missing folderId parameter', 400)
      }

      if (action === 'list') {
        const result = await listFilesAndFolders(accessToken, folderId, driveId || undefined)
        return jsonResponse(result)

      } else if (action === 'list-recursive') {
        const items = await listFilesRecursive(accessToken, folderId, driveId || undefined)
        return jsonResponse({ items })

      } else {
        return errorResponse('Invalid action', 400)
      }
    }

    // Handle POST requests (create-folder, upload)
    if (req.method === 'POST') {
      const body = await req.json()
      const { action, folderId, driveId, folderName, fileName, fileContent, mimeType } = body

      if (action === 'create-folder') {
        if (!folderId || !folderName) {
          return errorResponse('Missing folderId or folderName', 400)
        }

        const folder = await createFolder(accessToken, folderId, folderName, driveId)
        return jsonResponse({ success: true, folder })

      } else if (action === 'upload') {
        if (!folderId || !fileName || !fileContent) {
          return errorResponse('Missing folderId, fileName, or fileContent', 400)
        }

        const file = await uploadFile(
          accessToken,
          folderId,
          fileName,
          fileContent,
          mimeType || 'application/octet-stream'
        )
        return jsonResponse({ success: true, file })

      } else {
        return errorResponse('Invalid action', 400)
      }
    }

    return errorResponse('Method not allowed', 405)

  } catch (error) {
    console.error('[GoogleDriveFiles] Error:', error)
    return errorResponse(error.message || 'Request failed', 500)
  }
})

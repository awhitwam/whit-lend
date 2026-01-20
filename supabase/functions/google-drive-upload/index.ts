// Supabase Edge Function: Google Drive Upload
// Uploads files to Google Drive with automatic folder creation
//
// Folder structure: {base_folder}/{borrower_id} {description}/{loan_id} {description}/Letters/
// Smart matching: Finds existing folders by ID prefix even if description changed
//
// Actions:
//   - upload (default): Upload a file to the Letters folder
//   - create-folders: Create folder structure only (no file upload)
//
// Deployment:
//   supabase functions deploy google-drive-upload
//
// Required secrets:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { refreshTokenIfNeeded, getUserTokens } from '../_shared/tokenManagement.ts'
import { jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts'

interface Folder {
  id: string
  name: string
}

// List folders in a parent folder
async function listFolders(accessToken: string, parentId: string): Promise<Folder[]> {
  const query = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const data = await response.json()
  if (data.error) {
    throw new Error(data.error.message)
  }
  return data.files || []
}

// Find folder by ID prefix (e.g., "1000015" matches "1000015 C & F Developments")
function findFolderByIdPrefix(folders: Folder[], idPrefix: string): Folder | null {
  // Match folders starting with "{id} " or exactly "{id}"
  return folders.find(f =>
    f.name.startsWith(idPrefix + ' ') || f.name === idPrefix
  ) || null
}

// Create a new folder
async function createFolder(accessToken: string, parentId: string, name: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    })
  })
  const data = await response.json()
  if (data.error) {
    throw new Error(data.error.message)
  }
  return data.id
}

// Rename a folder
async function renameFolder(accessToken: string, folderId: string, newName: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: newName })
  })
  const data = await response.json()
  if (data.error) {
    throw new Error(data.error.message)
  }
}

// Find or create folder by ID prefix, rename if description changed
async function findOrCreateFolder(
  accessToken: string,
  parentId: string,
  idPrefix: string,
  fullName: string
): Promise<string> {
  const folders = await listFolders(accessToken, parentId)
  const existing = findFolderByIdPrefix(folders, idPrefix)

  if (existing) {
    console.log(`[GoogleDriveUpload] Found existing folder: ${existing.name} (${existing.id})`)

    // Rename folder if the name has changed (but not for static folders like "Letters")
    if (existing.name !== fullName && idPrefix !== fullName) {
      console.log(`[GoogleDriveUpload] Renaming folder from "${existing.name}" to "${fullName}"`)
      await renameFolder(accessToken, existing.id, fullName)
    }

    return existing.id
  }

  console.log(`[GoogleDriveUpload] Creating new folder: ${fullName}`)
  return await createFolder(accessToken, parentId, fullName)
}

// Upload file to Google Drive
async function uploadFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  base64Content: string,
  mimeType: string
): Promise<{ id: string; webViewLink: string }> {
  const boundary = '-------314159265358979323846'
  const metadata = {
    name: fileName,
    parents: [folderId]
  }

  // Build multipart request body
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
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
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
  return { id: data.id, webViewLink: data.webViewLink }
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

    // Parse request
    const body = await req.json()
    const {
      action = 'upload',  // 'upload' or 'create-folders'
      fileName,
      fileContent,  // base64
      mimeType = 'application/pdf',
      borrowerId,
      borrowerDescription,
      loanId,
      loanDescription,
      organizationId
    } = body

    // Validate organizationId is always required
    if (!organizationId) {
      return errorResponse('Missing required field: organizationId', 400)
    }

    // Validate required fields based on action
    if (action === 'upload') {
      if (!fileName || !fileContent || !borrowerId || !loanId) {
        return errorResponse('Missing required fields: fileName, fileContent, borrowerId, loanId', 400)
      }
      console.log('[GoogleDriveUpload] Upload request:', { fileName, borrowerId, loanId, organizationId })
    } else if (action === 'create-folders') {
      if (!borrowerId || !loanId) {
        return errorResponse('Missing required fields: borrowerId, loanId', 400)
      }
      console.log('[GoogleDriveUpload] Create folders request:', { borrowerId, loanId, organizationId })
    } else {
      return errorResponse('Invalid action. Use "upload" or "create-folders"', 400)
    }

    // Get user's Google Drive connection status (user-level)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('google_drive_connected')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.google_drive_connected) {
      return errorResponse('Google Drive not connected', 400)
    }

    // Get organization's base folder (org-level)
    const { data: orgData, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('google_drive_base_folder_id')
      .eq('id', organizationId)
      .single()

    if (orgError || !orgData?.google_drive_base_folder_id) {
      return errorResponse('No base folder configured for this organization. Please select a base folder in Settings.', 400)
    }

    const baseFolderId = orgData.google_drive_base_folder_id

    // Get tokens
    const tokenData = await getUserTokens(supabaseAdmin, user.id)

    if (!tokenData) {
      return errorResponse('No Google Drive tokens found. Please reconnect.', 400)
    }

    // Get valid access token (refresh if needed)
    const accessToken = await refreshTokenIfNeeded({
      supabaseAdmin,
      userId: user.id,
      tokenData,
      encryptionKey,
      googleClientId,
      googleClientSecret
    })

    // Find or create borrower folder
    const borrowerFolderName = `${borrowerId} ${borrowerDescription || ''}`.trim()
    const borrowerFolderId = await findOrCreateFolder(
      accessToken,
      baseFolderId,
      borrowerId,
      borrowerFolderName
    )

    // Find or create loan folder
    const loanFolderName = `${loanId} ${loanDescription || ''}`.trim()
    const loanFolderId = await findOrCreateFolder(
      accessToken,
      borrowerFolderId,
      loanId,
      loanFolderName
    )

    // Find or create subfolders within loan folder
    const lettersFolderId = await findOrCreateFolder(
      accessToken,
      loanFolderId,
      'Letters',
      'Letters'
    )

    // For create-folders action, also create DD and Legal subfolders
    if (action === 'create-folders') {
      const ddFolderId = await findOrCreateFolder(
        accessToken,
        loanFolderId,
        'DD',
        'DD'
      )
      const legalFolderId = await findOrCreateFolder(
        accessToken,
        loanFolderId,
        'Legal',
        'Legal'
      )

      const folderPath = `${borrowerFolderName}/${loanFolderName}`
      console.log('[GoogleDriveUpload] Folders created successfully:', folderPath)
      return jsonResponse({
        success: true,
        folderPath,
        borrowerFolderId,
        loanFolderId,
        lettersFolderId,
        ddFolderId,
        legalFolderId
      })
    }

    const folderPath = `${borrowerFolderName}/${loanFolderName}/Letters`

    // Upload file to Letters folder
    const result = await uploadFile(accessToken, lettersFolderId, fileName, fileContent, mimeType)

    console.log('[GoogleDriveUpload] File uploaded successfully:', result.id)

    return jsonResponse({
      success: true,
      fileId: result.id,
      fileUrl: result.webViewLink,
      folderPath
    })

  } catch (error) {
    console.error('[GoogleDriveUpload] Error:', error)
    return errorResponse(error.message || 'Upload failed', 500)
  }
})

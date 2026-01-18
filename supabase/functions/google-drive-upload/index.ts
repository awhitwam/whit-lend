// Supabase Edge Function: Google Drive Upload
// Uploads files to Google Drive with automatic folder creation
//
// Folder structure: {base_folder}/{borrower_id} {description}/{loan_id} {description}/
// Smart matching: Finds existing folders by ID prefix even if description changed
//
// Deployment:
//   supabase functions deploy google-drive-upload
//
// Required secrets:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Token decryption (must match google-drive-auth)
function decryptToken(encrypted: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key)
  const encryptedBytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const decrypted = new Uint8Array(encryptedBytes.length)
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length]
  }
  return new TextDecoder().decode(decrypted)
}

function encryptToken(token: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key)
  const tokenBytes = new TextEncoder().encode(token)
  const encrypted = new Uint8Array(tokenBytes.length)
  for (let i = 0; i < tokenBytes.length; i++) {
    encrypted[i] = tokenBytes[i] ^ keyBytes[i % keyBytes.length]
  }
  return btoa(String.fromCharCode(...encrypted))
}

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

// Find or create folder by ID prefix
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

// Refresh token if expired
async function refreshTokenIfNeeded(
  supabaseAdmin: any,
  userId: string,
  tokenData: any,
  encryptionKey: string,
  googleClientId: string,
  googleClientSecret: string
): Promise<string> {
  const tokenExpiry = new Date(tokenData.token_expiry)
  const now = new Date()

  // Refresh if token expires in less than 5 minutes
  if (tokenExpiry.getTime() - now.getTime() > 5 * 60 * 1000) {
    return decryptToken(tokenData.access_token_encrypted, encryptionKey)
  }

  console.log('[GoogleDriveUpload] Token expired or expiring soon, refreshing...')

  const refreshToken = decryptToken(tokenData.refresh_token_encrypted, encryptionKey)

  const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: googleClientId,
      client_secret: googleClientSecret,
      grant_type: 'refresh_token'
    })
  })

  const newTokens = await refreshResponse.json()

  if (newTokens.error) {
    throw new Error('Token refresh failed. Please reconnect Google Drive.')
  }

  // Update stored tokens
  const newExpiry = new Date(Date.now() + (newTokens.expires_in * 1000)).toISOString()

  await supabaseAdmin
    .from('google_drive_tokens')
    .update({
      access_token_encrypted: encryptToken(newTokens.access_token, encryptionKey),
      token_expiry: newExpiry,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)

  return newTokens.access_token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
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
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid user token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Parse request
    const body = await req.json()
    const {
      fileName,
      fileContent,  // base64
      mimeType = 'application/pdf',
      borrowerId,
      borrowerDescription,
      loanId,
      loanDescription
    } = body

    if (!fileName || !fileContent || !borrowerId || !loanId) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: fileName, fileContent, borrowerId, loanId'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[GoogleDriveUpload] Upload request:', { fileName, borrowerId, loanId })

    // Get user's Google Drive settings and tokens
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('google_drive_connected, google_drive_base_folder_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.google_drive_connected) {
      return new Response(JSON.stringify({ error: 'Google Drive not connected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!profile.google_drive_base_folder_id) {
      return new Response(JSON.stringify({ error: 'No base folder configured. Please select a base folder in Settings.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get tokens
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from('google_drive_tokens')
      .select('access_token_encrypted, refresh_token_encrypted, token_expiry')
      .eq('user_id', user.id)
      .single()

    if (tokenError || !tokenData) {
      return new Response(JSON.stringify({ error: 'No Google Drive tokens found. Please reconnect.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get valid access token (refresh if needed)
    const accessToken = await refreshTokenIfNeeded(
      supabaseAdmin,
      user.id,
      tokenData,
      encryptionKey,
      googleClientId,
      googleClientSecret
    )

    // Find or create borrower folder
    const borrowerFolderName = `${borrowerId} ${borrowerDescription || ''}`.trim()
    const borrowerFolderId = await findOrCreateFolder(
      accessToken,
      profile.google_drive_base_folder_id,
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

    // Upload file
    const result = await uploadFile(accessToken, loanFolderId, fileName, fileContent, mimeType)

    console.log('[GoogleDriveUpload] File uploaded successfully:', result.id)

    return new Response(JSON.stringify({
      success: true,
      fileId: result.id,
      fileUrl: result.webViewLink,
      folderPath: `${borrowerFolderName}/${loanFolderName}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[GoogleDriveUpload] Error:', error)
    return new Response(JSON.stringify({ error: error.message || 'Upload failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

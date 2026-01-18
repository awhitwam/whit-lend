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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

  if (tokenExpiry.getTime() - now.getTime() > 5 * 60 * 1000) {
    return decryptToken(tokenData.access_token_encrypted, encryptionKey)
  }

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
    throw new Error('Token refresh failed')
  }

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

// List files and folders in a parent folder
async function listFilesAndFolders(
  accessToken: string,
  folderId: string,
  driveId?: string
): Promise<{ items: DriveItem[], nextPageToken?: string }> {
  const query = `'${folderId}' in parents and trashed=false`
  const fields = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)'

  let apiUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&pageSize=100&orderBy=folder,name`

  // For shared drives, need additional parameters
  if (driveId && driveId !== 'root') {
    apiUrl += `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${driveId}`
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
  const result: DriveItem[] = []
  const { items } = await listFilesAndFolders(accessToken, folderId, driveId)

  for (const item of items) {
    if (item.isFolder) {
      // Recurse into subfolder
      const subItems = await listFilesRecursive(
        accessToken,
        item.id,
        driveId,
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

    // Get tokens
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from('google_drive_tokens')
      .select('access_token_encrypted, refresh_token_encrypted, token_expiry')
      .eq('user_id', user.id)
      .single()

    if (tokenError || !tokenData) {
      return new Response(JSON.stringify({ error: 'Google Drive not connected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const accessToken = await refreshTokenIfNeeded(
      supabaseAdmin,
      user.id,
      tokenData,
      encryptionKey,
      googleClientId,
      googleClientSecret
    )

    // Handle GET requests (list actions)
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const action = url.searchParams.get('action') || 'list'
      const folderId = url.searchParams.get('folderId')
      const driveId = url.searchParams.get('driveId')

      if (!folderId) {
        return new Response(JSON.stringify({ error: 'Missing folderId parameter' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (action === 'list') {
        const result = await listFilesAndFolders(accessToken, folderId, driveId || undefined)
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

      } else if (action === 'list-recursive') {
        const items = await listFilesRecursive(accessToken, folderId, driveId || undefined)
        return new Response(JSON.stringify({ items }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

      } else {
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // Handle POST requests (create-folder, upload)
    if (req.method === 'POST') {
      const body = await req.json()
      const { action, folderId, driveId, folderName, fileName, fileContent, mimeType } = body

      if (action === 'create-folder') {
        if (!folderId || !folderName) {
          return new Response(JSON.stringify({ error: 'Missing folderId or folderName' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const folder = await createFolder(accessToken, folderId, folderName, driveId)
        return new Response(JSON.stringify({ success: true, folder }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

      } else if (action === 'upload') {
        if (!folderId || !fileName || !fileContent) {
          return new Response(JSON.stringify({ error: 'Missing folderId, fileName, or fileContent' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const file = await uploadFile(
          accessToken,
          folderId,
          fileName,
          fileContent,
          mimeType || 'application/octet-stream'
        )
        return new Response(JSON.stringify({ success: true, file }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

      } else {
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[GoogleDriveFiles] Error:', error)
    return new Response(JSON.stringify({ error: error.message || 'Request failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

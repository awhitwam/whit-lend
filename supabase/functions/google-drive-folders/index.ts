// Supabase Edge Function: Google Drive Folders
// Browse folders and shared drives for folder picker UI
//
// Deployment:
//   supabase functions deploy google-drive-folders
//
// Endpoints:
//   GET ?action=list&folderId=xxx - List folders in a folder
//   GET ?action=shared-drives - List accessible shared drives
//   POST ?action=save-base - Save selected base folder

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

    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'list'

    if (action === 'shared-drives') {
      // List shared drives
      const response = await fetch(
        'https://www.googleapis.com/drive/v3/drives?pageSize=100&fields=drives(id,name)',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const data = await response.json()

      if (data.error) {
        throw new Error(data.error.message)
      }

      // Also include "My Drive" as an option
      const drives = [
        { id: 'root', name: 'My Drive', type: 'mydrive' },
        ...(data.drives || []).map((d: any) => ({ ...d, type: 'shared' }))
      ]

      return new Response(JSON.stringify({ drives }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } else if (action === 'list') {
      // List folders in a folder
      const folderId = url.searchParams.get('folderId') || 'root'
      const driveId = url.searchParams.get('driveId')

      let apiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)&pageSize=100&orderBy=name`

      // For shared drives, need to include additional parameters
      if (driveId && driveId !== 'root') {
        apiUrl += `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${driveId}`
      }

      const response = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const data = await response.json()

      if (data.error) {
        throw new Error(data.error.message)
      }

      return new Response(JSON.stringify({
        folders: data.files || [],
        parentId: folderId
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } else if (action === 'save-base') {
      // Save base folder selection (organization-level, super admin only)
      const body = await req.json()
      const { folderId, folderPath, organizationId } = body

      if (!folderId) {
        return new Response(JSON.stringify({ error: 'Missing folderId' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (!organizationId) {
        return new Response(JSON.stringify({ error: 'Missing organizationId' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Verify user is super admin
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('is_super_admin')
        .eq('id', user.id)
        .single()

      if (profileError || !profile?.is_super_admin) {
        return new Response(JSON.stringify({ error: 'Super admin access required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Save to organizations table (not user_profiles)
      const { error: updateError } = await supabaseAdmin
        .from('organizations')
        .update({
          google_drive_base_folder_id: folderId,
          google_drive_base_folder_path: folderPath || folderId
        })
        .eq('id', organizationId)

      if (updateError) {
        throw new Error('Failed to save folder selection')
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } else {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

  } catch (error) {
    console.error('[GoogleDriveFolders] Error:', error)
    return new Response(JSON.stringify({ error: error.message || 'Request failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

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
import { refreshTokenIfNeeded, getUserTokens } from '../_shared/tokenManagement.ts'
import { jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts'

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

      return jsonResponse({ drives })

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

      return jsonResponse({
        folders: data.files || [],
        parentId: folderId
      })

    } else if (action === 'save-base') {
      // Save base folder selection (organization-level, super admin only)
      const body = await req.json()
      const { folderId, folderPath, organizationId } = body

      if (!folderId) {
        return errorResponse('Missing folderId', 400)
      }

      if (!organizationId) {
        return errorResponse('Missing organizationId', 400)
      }

      // Verify user is super admin
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('is_super_admin')
        .eq('id', user.id)
        .single()

      if (profileError || !profile?.is_super_admin) {
        return errorResponse('Super admin access required', 403)
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

      return jsonResponse({ success: true })

    } else {
      return errorResponse('Invalid action', 400)
    }

  } catch (error) {
    console.error('[GoogleDriveFolders] Error:', error)
    return errorResponse(error.message || 'Request failed', 500)
  }
})

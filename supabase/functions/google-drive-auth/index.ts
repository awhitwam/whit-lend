// Supabase Edge Function: Google Drive Authentication
// Handles OAuth token exchange, refresh, and disconnect for Google Drive integration
// Tokens are stored per-organization (not per-user)
//
// Deployment:
//   supabase functions deploy google-drive-auth
//
// Required secrets (set via Supabase dashboard or CLI):
//   GOOGLE_CLIENT_ID - OAuth client ID from Google Cloud Console
//   GOOGLE_CLIENT_SECRET - OAuth client secret
//   TOKEN_ENCRYPTION_KEY - 32-character key for AES encryption

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptToken, decryptToken } from '../_shared/crypto.ts'
import { corsHeaders, jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handleCors()
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID')
    const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')

    if (!googleClientId || !googleClientSecret || !encryptionKey) {
      console.error('[GoogleDriveAuth] Missing required environment variables')
      return errorResponse('Google Drive integration not configured', 500)
    }

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Verify user authorization
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return errorResponse('Missing authorization header', 401)
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      return errorResponse('Invalid user token', 401)
    }

    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'callback'

    // Handle different actions
    if (action === 'callback') {
      // Exchange authorization code for tokens
      const body = await req.json()
      const { code, redirect_uri, organization_id } = body

      if (!code || !redirect_uri) {
        return errorResponse('Missing code or redirect_uri', 400)
      }

      if (!organization_id) {
        return errorResponse('Missing organization_id', 400)
      }

      console.log('[GoogleDriveAuth] Exchanging code for tokens, org:', organization_id)

      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri,
          grant_type: 'authorization_code'
        })
      })

      const tokens = await tokenResponse.json()

      if (tokens.error) {
        console.error('[GoogleDriveAuth] Token exchange error:', tokens.error)
        return errorResponse(tokens.error_description || tokens.error, 400)
      }

      // Get user info from Google
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      })
      const googleUser = await userInfoResponse.json()

      console.log('[GoogleDriveAuth] Connected Google account:', googleUser.email, 'for org:', organization_id)

      // Encrypt and store tokens (keyed by organization_id)
      const tokenExpiry = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()

      const { error: upsertError } = await supabaseAdmin
        .from('google_drive_tokens')
        .upsert({
          user_id: user.id,
          organization_id,
          access_token_encrypted: encryptToken(tokens.access_token, encryptionKey),
          refresh_token_encrypted: encryptToken(tokens.refresh_token, encryptionKey),
          token_expiry: tokenExpiry,
          updated_at: new Date().toISOString()
        }, { onConflict: 'organization_id' })

      if (upsertError) {
        console.error('[GoogleDriveAuth] Failed to store tokens:', upsertError)
        return errorResponse('Failed to store tokens', 500)
      }

      // Update organization (not user_profiles)
      const { error: orgError } = await supabaseAdmin
        .from('organizations')
        .update({
          google_drive_connected: true,
          google_drive_email: googleUser.email
        })
        .eq('id', organization_id)

      if (orgError) {
        console.error('[GoogleDriveAuth] Failed to update organization:', orgError)
      }

      return jsonResponse({
        success: true,
        email: googleUser.email
      })

    } else if (action === 'refresh') {
      // Refresh expired access token
      const body = await req.json()
      const { organization_id } = body

      if (!organization_id) {
        return errorResponse('Missing organization_id', 400)
      }

      console.log('[GoogleDriveAuth] Refreshing token for org:', organization_id)

      // Get stored tokens by organization
      const { data: tokenData, error: tokenError } = await supabaseAdmin
        .from('google_drive_tokens')
        .select('refresh_token_encrypted')
        .eq('organization_id', organization_id)
        .single()

      if (tokenError || !tokenData) {
        return errorResponse('No tokens found', 404)
      }

      const refreshToken = decryptToken(tokenData.refresh_token_encrypted, encryptionKey)

      // Refresh the token
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
        console.error('[GoogleDriveAuth] Token refresh error:', newTokens.error)
        // If refresh fails, mark org as disconnected
        await supabaseAdmin
          .from('organizations')
          .update({ google_drive_connected: false })
          .eq('id', organization_id)

        return errorResponse('Token refresh failed. Please reconnect.', 401)
      }

      // Update stored tokens
      const tokenExpiry = new Date(Date.now() + (newTokens.expires_in * 1000)).toISOString()

      await supabaseAdmin
        .from('google_drive_tokens')
        .update({
          access_token_encrypted: encryptToken(newTokens.access_token, encryptionKey),
          token_expiry: tokenExpiry,
          updated_at: new Date().toISOString()
        })
        .eq('organization_id', organization_id)

      return jsonResponse({ success: true })

    } else if (action === 'disconnect') {
      // Revoke tokens and disconnect
      const body = await req.json()
      const { organization_id } = body

      if (!organization_id) {
        return errorResponse('Missing organization_id', 400)
      }

      console.log('[GoogleDriveAuth] Disconnecting org:', organization_id)

      // Get tokens to revoke
      const { data: tokenData } = await supabaseAdmin
        .from('google_drive_tokens')
        .select('access_token_encrypted')
        .eq('organization_id', organization_id)
        .single()

      if (tokenData) {
        const accessToken = decryptToken(tokenData.access_token_encrypted, encryptionKey)
        // Revoke token with Google (best effort)
        try {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {
            method: 'POST'
          })
        } catch (e) {
          console.log('[GoogleDriveAuth] Token revocation failed (may already be invalid)')
        }
      }

      // Delete tokens from database
      await supabaseAdmin
        .from('google_drive_tokens')
        .delete()
        .eq('organization_id', organization_id)

      // Update organization
      await supabaseAdmin
        .from('organizations')
        .update({
          google_drive_connected: false,
          google_drive_email: null
        })
        .eq('id', organization_id)

      return jsonResponse({ success: true })

    } else {
      return errorResponse('Invalid action', 400)
    }

  } catch (error) {
    console.error('[GoogleDriveAuth] Error:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
})

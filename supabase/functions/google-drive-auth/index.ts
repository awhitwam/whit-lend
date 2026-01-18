// Supabase Edge Function: Google Drive Authentication
// Handles OAuth token exchange, refresh, and disconnect for Google Drive integration
//
// Deployment:
//   supabase functions deploy google-drive-auth
//
// Required secrets (set via Supabase dashboard or CLI):
//   GOOGLE_CLIENT_ID - OAuth client ID from Google Cloud Console
//   GOOGLE_CLIENT_SECRET - OAuth client secret
//   TOKEN_ENCRYPTION_KEY - 32-character key for AES encryption

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Simple XOR-based encryption (for demonstration - in production use Web Crypto API)
function encryptToken(token: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key)
  const tokenBytes = new TextEncoder().encode(token)
  const encrypted = new Uint8Array(tokenBytes.length)
  for (let i = 0; i < tokenBytes.length; i++) {
    encrypted[i] = tokenBytes[i] ^ keyBytes[i % keyBytes.length]
  }
  return btoa(String.fromCharCode(...encrypted))
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

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID')
    const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')

    if (!googleClientId || !googleClientSecret || !encryptionKey) {
      console.error('[GoogleDriveAuth] Missing required environment variables')
      return new Response(JSON.stringify({ error: 'Google Drive integration not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Verify user authorization
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

    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'callback'

    // Handle different actions
    if (action === 'callback') {
      // Exchange authorization code for tokens
      const body = await req.json()
      const { code, redirect_uri } = body

      if (!code || !redirect_uri) {
        return new Response(JSON.stringify({ error: 'Missing code or redirect_uri' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      console.log('[GoogleDriveAuth] Exchanging code for tokens')

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
        return new Response(JSON.stringify({ error: tokens.error_description || tokens.error }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Get user info from Google
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      })
      const googleUser = await userInfoResponse.json()

      console.log('[GoogleDriveAuth] Connected Google account:', googleUser.email)

      // Encrypt and store tokens
      const tokenExpiry = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()

      const { error: upsertError } = await supabaseAdmin
        .from('google_drive_tokens')
        .upsert({
          user_id: user.id,
          access_token_encrypted: encryptToken(tokens.access_token, encryptionKey),
          refresh_token_encrypted: encryptToken(tokens.refresh_token, encryptionKey),
          token_expiry: tokenExpiry,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })

      if (upsertError) {
        console.error('[GoogleDriveAuth] Failed to store tokens:', upsertError)
        return new Response(JSON.stringify({ error: 'Failed to store tokens' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Update user profile
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          google_drive_connected: true,
          google_drive_email: googleUser.email
        })
        .eq('id', user.id)

      if (profileError) {
        console.error('[GoogleDriveAuth] Failed to update profile:', profileError)
      }

      return new Response(JSON.stringify({
        success: true,
        email: googleUser.email
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } else if (action === 'refresh') {
      // Refresh expired access token
      console.log('[GoogleDriveAuth] Refreshing token for user:', user.id)

      // Get stored tokens
      const { data: tokenData, error: tokenError } = await supabaseAdmin
        .from('google_drive_tokens')
        .select('refresh_token_encrypted')
        .eq('user_id', user.id)
        .single()

      if (tokenError || !tokenData) {
        return new Response(JSON.stringify({ error: 'No tokens found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
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
        // If refresh fails, user needs to re-authenticate
        await supabaseAdmin
          .from('user_profiles')
          .update({ google_drive_connected: false })
          .eq('id', user.id)

        return new Response(JSON.stringify({ error: 'Token refresh failed. Please reconnect.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
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
        .eq('user_id', user.id)

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } else if (action === 'disconnect') {
      // Revoke tokens and disconnect
      console.log('[GoogleDriveAuth] Disconnecting user:', user.id)

      // Get tokens to revoke
      const { data: tokenData } = await supabaseAdmin
        .from('google_drive_tokens')
        .select('access_token_encrypted')
        .eq('user_id', user.id)
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
        .eq('user_id', user.id)

      // Update user profile
      await supabaseAdmin
        .from('user_profiles')
        .update({
          google_drive_connected: false,
          google_drive_email: null,
          google_drive_base_folder_id: null,
          google_drive_base_folder_path: null
        })
        .eq('id', user.id)

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
    console.error('[GoogleDriveAuth] Error:', error)
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

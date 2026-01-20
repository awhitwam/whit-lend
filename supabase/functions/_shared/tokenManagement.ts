/**
 * Shared token management utilities for Google Drive OAuth
 *
 * Handles token refresh logic with automatic retry and user disconnection
 * on permanent failures.
 */

import { encryptToken, decryptToken } from './crypto.ts'

export interface TokenData {
  access_token_encrypted: string
  refresh_token_encrypted: string
  token_expiry: string
}

export interface TokenRefreshConfig {
  supabaseAdmin: any
  userId: string
  tokenData: TokenData
  encryptionKey: string
  googleClientId: string
  googleClientSecret: string
}

/**
 * Check if the stored token is still valid or needs refresh
 * Refreshes the token if it will expire within 5 minutes
 *
 * @param config - Configuration object with all required parameters
 * @returns The valid access token (either existing or newly refreshed)
 * @throws Error if token refresh fails permanently
 */
export async function refreshTokenIfNeeded(config: TokenRefreshConfig): Promise<string> {
  const {
    supabaseAdmin,
    userId,
    tokenData,
    encryptionKey,
    googleClientId,
    googleClientSecret
  } = config

  const tokenExpiry = new Date(tokenData.token_expiry)
  const now = new Date()

  // If token is still valid for more than 5 minutes, return the decrypted token
  if (tokenExpiry.getTime() - now.getTime() > 5 * 60 * 1000) {
    return decryptToken(tokenData.access_token_encrypted, encryptionKey)
  }

  // Token is expiring soon or already expired - refresh it
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
    // Mark user as disconnected when token refresh fails
    await supabaseAdmin
      .from('user_profiles')
      .update({ google_drive_connected: false })
      .eq('id', userId)

    throw new Error('Google Drive session expired. Please reconnect in Settings.')
  }

  // Calculate new expiry time
  const newExpiry = new Date(Date.now() + (newTokens.expires_in * 1000)).toISOString()

  // Update stored tokens in database
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

/**
 * Get user's Google Drive tokens from database
 *
 * @param supabaseAdmin - Supabase admin client
 * @param userId - User ID to fetch tokens for
 * @returns Token data or null if not found
 */
export async function getUserTokens(
  supabaseAdmin: any,
  userId: string
): Promise<TokenData | null> {
  const { data, error } = await supabaseAdmin
    .from('google_drive_tokens')
    .select('access_token_encrypted, refresh_token_encrypted, token_expiry')
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    return null
  }

  return data as TokenData
}

// Re-export crypto functions for convenience
export { encryptToken, decryptToken } from './crypto.ts'

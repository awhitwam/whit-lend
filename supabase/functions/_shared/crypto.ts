/**
 * Shared encryption/decryption utilities for Google Drive token management
 *
 * Uses XOR-based encryption with a secret key for storing OAuth tokens.
 * This provides basic obfuscation for tokens at rest in the database.
 */

/**
 * Encrypt a token string using XOR with the provided key
 * @param token - The plaintext token to encrypt
 * @param key - The encryption key
 * @returns Base64-encoded encrypted string
 */
export function encryptToken(token: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key)
  const tokenBytes = new TextEncoder().encode(token)
  const encrypted = new Uint8Array(tokenBytes.length)
  for (let i = 0; i < tokenBytes.length; i++) {
    encrypted[i] = tokenBytes[i] ^ keyBytes[i % keyBytes.length]
  }
  return btoa(String.fromCharCode(...encrypted))
}

/**
 * Decrypt an encrypted token string using XOR with the provided key
 * @param encrypted - The Base64-encoded encrypted string
 * @param key - The encryption key (must match the key used for encryption)
 * @returns The decrypted plaintext token
 */
export function decryptToken(encrypted: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key)
  const encryptedBytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const decrypted = new Uint8Array(encryptedBytes.length)
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length]
  }
  return new TextDecoder().decode(decrypted)
}

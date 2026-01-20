/**
 * Shared CORS headers for Supabase Edge Functions
 *
 * These headers allow cross-origin requests from the frontend application.
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Create a JSON response with CORS headers
 * @param data - The data to serialize as JSON
 * @param status - HTTP status code (default: 200)
 * @returns Response object with CORS headers
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

/**
 * Create an error response with CORS headers
 * @param message - Error message
 * @param status - HTTP status code (default: 500)
 * @returns Response object with error and CORS headers
 */
export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status)
}

/**
 * Handle OPTIONS preflight request
 * @returns Response with CORS headers and no body
 */
export function handleCors(): Response {
  return new Response(null, { headers: corsHeaders })
}

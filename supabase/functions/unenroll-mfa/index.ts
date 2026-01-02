// Supabase Edge Function: Unenroll MFA
// This function removes all MFA factors for a user (used during password reset)
// Uses admin API to bypass AAL2 requirement
//
// Deployment:
//   supabase functions deploy unenroll-mfa

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Get the user from the authorization header
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
      console.log('[UnenrollMFA] Invalid token:', userError?.message)
      return new Response(JSON.stringify({ error: 'Invalid user token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[UnenrollMFA] Unenrolling MFA for user:', user.id)

    // Get all MFA factors for the user using admin API
    const { data: factors, error: factorsError } = await supabaseAdmin.auth.admin.mfa.listFactors({
      userId: user.id
    })

    if (factorsError) {
      console.error('[UnenrollMFA] Error listing factors:', factorsError.message)
      return new Response(JSON.stringify({ error: `Failed to list MFA factors: ${factorsError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const allFactors = factors?.factors || []
    console.log('[UnenrollMFA] Found', allFactors.length, 'MFA factors')

    // Delete each factor using admin API
    let unenrolledCount = 0
    for (const factor of allFactors) {
      console.log('[UnenrollMFA] Deleting factor:', factor.id, factor.factor_type)
      const { error: deleteError } = await supabaseAdmin.auth.admin.mfa.deleteFactor({
        userId: user.id,
        factorId: factor.id
      })

      if (deleteError) {
        console.error('[UnenrollMFA] Error deleting factor:', factor.id, deleteError.message)
      } else {
        unenrolledCount++
      }
    }

    console.log('[UnenrollMFA] Successfully unenrolled', unenrolledCount, 'factors')

    return new Response(JSON.stringify({
      success: true,
      message: `Unenrolled ${unenrolledCount} MFA factors`,
      unenrolledCount
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[UnenrollMFA] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

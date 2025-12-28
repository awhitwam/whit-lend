// Supabase Edge Function: Invite User
// This function invites a user to an organization using Supabase Auth
//
// Deployment:
//   supabase functions deploy invite-user
//
// Manual invocation:
//   curl -i --location --request POST \
//     'https://YOUR_PROJECT_REF.supabase.co/functions/v1/invite-user' \
//     --header 'Authorization: Bearer USER_JWT_TOKEN' \
//     --header 'Content-Type: application/json' \
//     --data '{"email":"user@example.com","role":"Manager","organization_id":"uuid"}'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InviteRequest {
  email: string
  role: 'Admin' | 'Manager' | 'Viewer'
  organization_id: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Create admin client (for inviting users)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Create user client (to verify the requesting user's permissions)
    const authHeader = req.headers.get('Authorization')
    console.log('[InviteUser] Auth header present:', !!authHeader)

    if (!authHeader) {
      console.log('[InviteUser] No auth header found')
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Extract the token from the header
    const token = authHeader.replace('Bearer ', '')

    // Use the admin client to get the user from the token
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

    console.log('[InviteUser] User lookup result:', user?.id, userError?.message)

    if (userError || !user) {
      console.log('[InviteUser] Invalid token:', userError?.message)
      return new Response(JSON.stringify({ error: 'Invalid user token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Parse request body
    const { email, role, organization_id }: InviteRequest = await req.json()

    if (!email || !role || !organization_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields: email, role, organization_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate role
    if (!['Admin', 'Manager', 'Viewer'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Invalid role. Must be Admin, Manager, or Viewer' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verify the requesting user is an Admin of the organization
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('organization_id', organization_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (membershipError || !membership) {
      return new Response(JSON.stringify({ error: 'You are not a member of this organization' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (membership.role !== 'Admin') {
      return new Response(JSON.stringify({ error: 'Only Admins can invite users' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get organization details for the email
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', organization_id)
      .single()

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: 'Organization not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase())

    if (existingUser) {
      // Check if already a member of this org
      const { data: existingMember } = await supabaseAdmin
        .from('organization_members')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('user_id', existingUser.id)
        .single()

      if (existingMember) {
        return new Response(JSON.stringify({ error: 'User is already a member of this organization' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Add existing user directly to organization
      const { error: addError } = await supabaseAdmin
        .from('organization_members')
        .insert({
          organization_id,
          user_id: existingUser.id,
          role,
          invited_by: user.id,
          invited_at: new Date().toISOString(),
          joined_at: new Date().toISOString(),
          is_active: true
        })

      if (addError) {
        throw new Error(`Failed to add member: ${addError.message}`)
      }

      return new Response(JSON.stringify({
        success: true,
        message: `${email} has been added to the organization`,
        existingUser: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Invite new user via Supabase Auth
    const siteUrl = Deno.env.get('SITE_URL') || 'http://localhost:5173'

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          organization_id,
          role,
          invited_by: user.id,
          organization_name: org.name
        },
        redirectTo: `${siteUrl}/AcceptInvitation`
      }
    )

    if (inviteError) {
      console.error('Invite error:', inviteError)
      return new Response(JSON.stringify({ error: `Failed to send invitation: ${inviteError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Create a pending organization member record
    // This will be activated when the user confirms their email
    const { error: pendingMemberError } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id,
        user_id: inviteData.user.id,
        role,
        invited_by: user.id,
        invited_at: new Date().toISOString(),
        is_active: false // Will be activated on email confirmation
      })

    if (pendingMemberError) {
      console.error('Failed to create pending member:', pendingMemberError)
      // Don't fail the request, the user was still invited
    }

    console.log(`[InviteUser] Successfully invited ${email} to organization ${org.name}`)

    return new Response(JSON.stringify({
      success: true,
      message: `Invitation sent to ${email}`,
      user_id: inviteData.user.id
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[InviteUser] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

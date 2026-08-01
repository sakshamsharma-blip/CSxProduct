// Supabase Edge Function: invite-user
// Creates a new user with a temporary password and inserts their app_users profile.
// Called from the frontend by CS Lead or Product Lead.
//
// Deploy with: supabase functions deploy invite-user
// Set secret: supabase secrets set SERVICE_ROLE_KEY=your-service-role-key

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, full_name, role } = await req.json()

    if (!email || !full_name || !role) {
      return new Response(
        JSON.stringify({ error: 'email, full_name, and role are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate role
    const validRoles = ['CS_MANAGER', 'CS_LEAD', 'PRODUCT_LEAD']
    if (!validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create admin client with service role key
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verify the caller is CS_LEAD or PRODUCT_LEAD
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check caller's role
    const { data: callerProfile } = await supabaseAdmin
      .from('app_users')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (!callerProfile || !['CS_LEAD', 'PRODUCT_LEAD'].includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: 'Only CS Lead and Product Lead can invite users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generate a temporary password
    const tempPassword = generateTempPassword()

    // Create the user in Supabase Auth
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true, // Skip email confirmation
      user_metadata: { full_name, role },
    })

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Ensure app_users profile exists (trigger should handle it, but fallback)
    if (newUser.user) {
      await supabaseAdmin
        .from('app_users')
        .upsert({
          id: newUser.user.id,
          full_name,
          email,
          role,
        }, { onConflict: 'id' })
    }

    // Send password reset email so user can set their own password
    const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: Deno.env.get('SITE_URL') || 'http://localhost:5173',
    })

    if (resetError) {
      // User created but email failed — return temp password as fallback
      return new Response(
        JSON.stringify({
          success: true,
          message: `User ${email} created but invite email failed to send. Share the temporary password with them.`,
          temp_password: tempPassword,
          email_sent: false,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `User ${email} created. They will receive an email to set their password.`,
        temp_password: tempPassword, // Fallback in case email doesn't arrive
        email_sent: true,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let password = ''
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password + '!1' // Ensure it meets complexity requirements
}

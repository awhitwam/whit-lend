// Supabase Edge Function: Send Valuation Letter
// This function sends a valuation request letter with PDF attachment via SMTP
//
// Deployment:
//   supabase functions deploy send-valuation-letter
//
// Required secrets (set via Supabase dashboard or CLI):
//   SMTP_HOST - SMTP server hostname
//   SMTP_PORT - SMTP server port (usually 587 for TLS)
//   SMTP_USER - SMTP username
//   SMTP_PASS - SMTP password
//   SMTP_FROM - From email address
//
// Manual invocation:
//   curl -i --location --request POST \
//     'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-valuation-letter' \
//     --header 'Authorization: Bearer USER_JWT_TOKEN' \
//     --header 'Content-Type: application/json' \
//     --data '{"recipientEmail":"borrower@example.com","subject":"Valuation Request","borrowerName":"John Smith","loanNumber":"12345","organizationName":"ABC Lending","pdfBase64":"...","fileName":"valuation-request.pdf"}'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

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

    // Create admin client to verify user
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Verify authorization
    const authHeader = req.headers.get('Authorization')
    console.log('[SendValuationLetter] Auth header present:', !!authHeader)

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      console.log('[SendValuationLetter] Invalid token:', userError?.message)
      return new Response(JSON.stringify({ error: 'Invalid user token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Parse request body
    let recipientEmail: string,
        subject: string,
        borrowerName: string,
        loanNumber: string,
        organizationName: string,
        pdfBase64: string,
        fileName: string

    try {
      const body = await req.json()
      recipientEmail = body.recipientEmail
      subject = body.subject
      borrowerName = body.borrowerName
      loanNumber = body.loanNumber
      organizationName = body.organizationName
      pdfBase64 = body.pdfBase64
      fileName = body.fileName
    } catch (parseError) {
      console.error('[SendValuationLetter] Failed to parse request body:', parseError)
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[SendValuationLetter] Request for:', { recipientEmail, subject, borrowerName, loanNumber })

    if (!recipientEmail || !subject || !pdfBase64 || !fileName) {
      return new Response(JSON.stringify({ error: 'Missing required fields: recipientEmail, subject, pdfBase64, fileName' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(recipientEmail)) {
      return new Response(JSON.stringify({ error: 'Invalid email address format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get SMTP configuration from environment
    const smtpHost = Deno.env.get('SMTP_HOST')
    const smtpPort = parseInt(Deno.env.get('SMTP_PORT') || '587')
    const smtpUser = Deno.env.get('SMTP_USER')
    const smtpPass = Deno.env.get('SMTP_PASS')
    const smtpFrom = Deno.env.get('SMTP_FROM')

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
      console.error('[SendValuationLetter] Missing SMTP configuration')
      return new Response(JSON.stringify({ error: 'Email service not configured. Please contact your administrator.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Create SMTP client
    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        tls: true,
        auth: {
          username: smtpUser,
          password: smtpPass,
        },
      },
    })

    // Decode base64 PDF to Uint8Array for attachment
    const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0))

    // Build HTML email body
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #0066cc; padding-bottom: 10px; margin-bottom: 20px; }
    .header h1 { color: #0066cc; margin: 0; font-size: 24px; }
    .content { margin-bottom: 20px; }
    .footer { border-top: 1px solid #ddd; padding-top: 15px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${organizationName || 'Lender'}</h1>
    </div>
    <div class="content">
      <p>Dear ${borrowerName || 'Borrower'},</p>
      <p>Please find attached our formal request for updated property valuation evidence regarding your loan facility (Reference: ${loanNumber || 'N/A'}).</p>
      <p>The attached letter provides full details of our requirements. Please review and action within the timeframe specified.</p>
      <p>If you have any questions, please do not hesitate to contact us.</p>
      <p>Kind regards,<br>${organizationName || 'The Lender'}</p>
    </div>
    <div class="footer">
      <p>This email and any attachments are confidential and intended solely for the addressee. If you have received this email in error, please notify the sender immediately and delete it.</p>
    </div>
  </div>
</body>
</html>
`

    // Plain text fallback
    const textBody = `
Dear ${borrowerName || 'Borrower'},

Please find attached our formal request for updated property valuation evidence regarding your loan facility (Reference: ${loanNumber || 'N/A'}).

The attached letter provides full details of our requirements. Please review and action within the timeframe specified.

If you have any questions, please do not hesitate to contact us.

Kind regards,
${organizationName || 'The Lender'}

---
This email and any attachments are confidential and intended solely for the addressee.
`

    // Send email with attachment
    console.log('[SendValuationLetter] Sending email to:', recipientEmail)

    await client.send({
      from: smtpFrom,
      to: recipientEmail,
      subject: subject,
      content: textBody,
      html: htmlBody,
      attachments: [
        {
          filename: fileName,
          content: pdfBytes,
          contentType: 'application/pdf',
        },
      ],
    })

    await client.close()

    console.log('[SendValuationLetter] Email sent successfully to:', recipientEmail)

    // Log to audit (optional - could add audit logging here)

    return new Response(JSON.stringify({
      success: true,
      message: `Letter sent successfully to ${recipientEmail}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[SendValuationLetter] Error:', error)
    return new Response(JSON.stringify({
      error: error.message || 'Failed to send email'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

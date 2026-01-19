// Supabase Edge Function: Send Email with Attachment
// Generic function to send emails with file attachments via SMTP
// Supports both PDF (base64) and Google Drive file attachments
//
// Deployment:
//   supabase functions deploy send-email-attachment
//
// Required secrets (set via Supabase dashboard or CLI):
//   SMTP_HOST - SMTP server hostname
//   SMTP_PORT - SMTP server port (usually 587 for TLS)
//   SMTP_USER - SMTP username
//   SMTP_PASS - SMTP password
//   SMTP_FROM - From email address

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AttachmentPdf {
  type: 'pdf'
  base64: string
  fileName: string
}

interface AttachmentDriveFile {
  type: 'driveFile'
  fileId: string
  fileName: string
  mimeType?: string
}

type Attachment = AttachmentPdf | AttachmentDriveFile

interface RequestBody {
  recipientEmail: string
  subject: string
  htmlBody: string
  textBody?: string
  attachment: Attachment
  organizationName?: string
}

// Helper to strip HTML tags for plain text fallback
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

// Helper to get file content from Google Drive
async function getGoogleDriveFile(
  fileId: string,
  accessToken: string
): Promise<{ content: Uint8Array; mimeType: string; fileName: string }> {
  // First get file metadata
  const metadataRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,size`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  if (!metadataRes.ok) {
    const error = await metadataRes.text()
    throw new Error(`Failed to get file metadata: ${error}`)
  }

  const metadata = await metadataRes.json()

  // Check file size (limit to 10MB)
  if (metadata.size && parseInt(metadata.size) > 10 * 1024 * 1024) {
    throw new Error('File too large. Maximum size is 10MB.')
  }

  // Download file content
  const contentRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  if (!contentRes.ok) {
    const error = await contentRes.text()
    throw new Error(`Failed to download file: ${error}`)
  }

  const arrayBuffer = await contentRes.arrayBuffer()
  const content = new Uint8Array(arrayBuffer)

  return {
    content,
    mimeType: metadata.mimeType || 'application/octet-stream',
    fileName: metadata.name || 'attachment',
  }
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
    console.log('[SendEmailAttachment] Auth header present:', !!authHeader)

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      console.log('[SendEmailAttachment] Invalid token:', userError?.message)
      return new Response(JSON.stringify({ error: 'Invalid user token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Parse request body
    let body: RequestBody
    try {
      body = await req.json()
    } catch (parseError) {
      console.error('[SendEmailAttachment] Failed to parse request body:', parseError)
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { recipientEmail, subject, htmlBody, textBody, attachment, organizationName } = body

    console.log('[SendEmailAttachment] Request:', {
      recipientEmail,
      subject,
      attachmentType: attachment?.type,
      attachmentFileName: attachment?.type === 'pdf' ? attachment.fileName : attachment?.fileName
    })

    // Validate required fields
    if (!recipientEmail || !subject || !htmlBody || !attachment) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: recipientEmail, subject, htmlBody, attachment'
      }), {
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
      console.error('[SendEmailAttachment] Missing SMTP configuration')
      return new Response(JSON.stringify({
        error: 'Email service not configured. Please contact your administrator.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Prepare attachment data
    let attachmentContent: Uint8Array
    let attachmentFileName: string
    let attachmentMimeType: string

    if (attachment.type === 'pdf') {
      // Decode base64 PDF to Uint8Array
      attachmentContent = Uint8Array.from(atob(attachment.base64), c => c.charCodeAt(0))
      attachmentFileName = attachment.fileName
      attachmentMimeType = 'application/pdf'
    } else if (attachment.type === 'driveFile') {
      // Get user's Google Drive access token from database
      const { data: driveTokenData, error: tokenError } = await supabaseAdmin
        .from('google_drive_tokens')
        .select('access_token, refresh_token, expires_at')
        .eq('user_id', user.id)
        .single()

      if (tokenError || !driveTokenData) {
        console.error('[SendEmailAttachment] No Google Drive token found:', tokenError?.message)
        return new Response(JSON.stringify({
          error: 'Google Drive not connected. Please reconnect Google Drive in settings.'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      let accessToken = driveTokenData.access_token

      // Check if token is expired and refresh if needed
      if (driveTokenData.expires_at && new Date(driveTokenData.expires_at) < new Date()) {
        console.log('[SendEmailAttachment] Token expired, refreshing...')

        const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
        const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')

        if (!clientId || !clientSecret) {
          return new Response(JSON.stringify({
            error: 'Google Drive configuration missing'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: driveTokenData.refresh_token,
            grant_type: 'refresh_token',
          }),
        })

        if (!refreshRes.ok) {
          return new Response(JSON.stringify({
            error: 'Failed to refresh Google Drive token. Please reconnect Google Drive.'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const refreshData = await refreshRes.json()
        accessToken = refreshData.access_token

        // Update token in database
        await supabaseAdmin
          .from('google_drive_tokens')
          .update({
            access_token: accessToken,
            expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
          })
          .eq('user_id', user.id)
      }

      // Fetch file from Google Drive
      try {
        const driveFile = await getGoogleDriveFile(attachment.fileId, accessToken)
        attachmentContent = driveFile.content
        attachmentFileName = attachment.fileName || driveFile.fileName
        attachmentMimeType = attachment.mimeType || driveFile.mimeType
      } catch (driveError) {
        console.error('[SendEmailAttachment] Failed to get Drive file:', driveError)
        return new Response(JSON.stringify({
          error: `Failed to get file from Google Drive: ${driveError.message}`
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    } else {
      return new Response(JSON.stringify({
        error: 'Invalid attachment type. Must be "pdf" or "driveFile".'
      }), {
        status: 400,
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

    // Wrap HTML body with email template
    const fullHtmlBody = `
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
      ${htmlBody}
    </div>
    <div class="footer">
      <p>This email and any attachments are confidential and intended solely for the addressee. If you have received this email in error, please notify the sender immediately and delete it.</p>
    </div>
  </div>
</body>
</html>
`

    // Use provided text body or strip HTML
    const finalTextBody = textBody || stripHtml(htmlBody)

    // Send email with attachment
    console.log('[SendEmailAttachment] Sending email to:', recipientEmail)

    await client.send({
      from: smtpFrom,
      to: recipientEmail,
      subject: subject,
      content: finalTextBody,
      html: fullHtmlBody,
      attachments: [
        {
          filename: attachmentFileName,
          content: attachmentContent,
          contentType: attachmentMimeType,
        },
      ],
    })

    await client.close()

    console.log('[SendEmailAttachment] Email sent successfully to:', recipientEmail)

    return new Response(JSON.stringify({
      success: true,
      message: `Email sent successfully to ${recipientEmail}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[SendEmailAttachment] Error:', error)
    return new Response(JSON.stringify({
      error: error.message || 'Failed to send email'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

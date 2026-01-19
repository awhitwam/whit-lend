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
import { encode as base64Encode } from 'https://deno.land/std@0.208.0/encoding/base64.ts'

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
  textBody: string
  htmlBody?: string // Deprecated - kept for backwards compatibility, not used
  attachment: Attachment
  organizationName?: string
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

// Simple SMTP client using raw TCP with TLS
class SimpleSmtpClient {
  private conn: Deno.Conn | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private textDecoder = new TextDecoder()
  private textEncoder = new TextEncoder()
  private isTls = false

  async connect(hostname: string, port: number): Promise<void> {
    this.conn = await Deno.connect({ hostname, port })
    this.reader = this.conn.readable.getReader()
    this.writer = this.conn.writable.getWriter()
    this.isTls = false
    await this.readResponse() // Read greeting
  }

  async startTls(hostname: string): Promise<void> {
    if (!this.conn || this.isTls) {
      throw new Error('No TCP connection to upgrade or already TLS')
    }

    // Release readers/writers before TLS upgrade
    this.reader?.releaseLock()
    this.writer?.releaseLock()

    // Upgrade to TLS - cast to any to avoid type issues in Supabase runtime
    this.conn = await Deno.startTls(this.conn as any, { hostname })
    this.reader = this.conn.readable.getReader()
    this.writer = this.conn.writable.getWriter()
    this.isTls = true
  }

  async connectTls(hostname: string, port: number): Promise<void> {
    this.conn = await Deno.connectTls({ hostname, port })
    this.reader = this.conn.readable.getReader()
    this.writer = this.conn.writable.getWriter()
    this.isTls = true
    await this.readResponse() // Read greeting
  }

  private async readResponse(): Promise<string> {
    if (!this.reader) throw new Error('Not connected')

    let response = ''
    while (true) {
      const { value, done } = await this.reader.read()
      if (done) break

      response += this.textDecoder.decode(value)
      // Check if response is complete (ends with \r\n and has a space after code)
      const lines = response.split('\r\n')
      const lastCompleteLine = lines[lines.length - 2] || lines[lines.length - 1]
      if (lastCompleteLine && lastCompleteLine.length >= 4 && lastCompleteLine[3] === ' ') {
        break
      }
      // Also break if we have a complete single-line response
      if (response.endsWith('\r\n') && response.split('\r\n').filter(l => l).every(l => l[3] === ' ')) {
        break
      }
    }

    const code = parseInt(response.substring(0, 3))
    if (code >= 400) {
      throw new Error(`SMTP Error ${code}: ${response}`)
    }

    return response
  }

  private async sendCommand(command: string): Promise<string> {
    if (!this.writer) throw new Error('Not connected')
    await this.writer.write(this.textEncoder.encode(command + '\r\n'))
    return await this.readResponse()
  }

  async ehlo(hostname: string): Promise<string> {
    return await this.sendCommand(`EHLO ${hostname}`)
  }

  async starttls(): Promise<void> {
    await this.sendCommand('STARTTLS')
  }

  async auth(username: string, password: string): Promise<void> {
    await this.sendCommand('AUTH LOGIN')
    await this.sendCommand(btoa(username))
    await this.sendCommand(btoa(password))
  }

  async mailFrom(from: string): Promise<void> {
    // Extract email from "Name <email>" format
    const emailMatch = from.match(/<([^>]+)>/)
    const email = emailMatch ? emailMatch[1] : from
    await this.sendCommand(`MAIL FROM:<${email}>`)
  }

  async rcptTo(to: string): Promise<void> {
    await this.sendCommand(`RCPT TO:<${to}>`)
  }

  async data(content: string): Promise<void> {
    await this.sendCommand('DATA')
    if (!this.writer) throw new Error('Not connected')
    // Send content followed by terminator
    await this.writer.write(this.textEncoder.encode(content + '\r\n.\r\n'))
    await this.readResponse()
  }

  async quit(): Promise<void> {
    try {
      await this.sendCommand('QUIT')
    } catch {
      // Ignore errors on quit
    }
  }

  async close(): Promise<void> {
    try {
      this.reader?.releaseLock()
      this.writer?.releaseLock()
      this.conn?.close()
    } catch {
      // Ignore close errors
    }
  }
}

// Send email using SMTP
async function sendSmtpEmail(
  smtpHost: string,
  smtpPort: number,
  smtpUser: string,
  smtpPass: string,
  smtpFrom: string,
  recipientEmail: string,
  mimeMessage: string
): Promise<void> {
  const client = new SimpleSmtpClient()

  try {
    if (smtpPort === 465) {
      // Direct TLS connection
      console.log('[SMTP] Connecting with TLS to', smtpHost, smtpPort)
      await client.connectTls(smtpHost, smtpPort)
    } else {
      // Connect plain, then upgrade with STARTTLS
      console.log('[SMTP] Connecting to', smtpHost, smtpPort)
      await client.connect(smtpHost, smtpPort)
    }

    console.log('[SMTP] Sending EHLO')
    const ehloResponse = await client.ehlo('localhost')
    console.log('[SMTP] EHLO response received')

    // Use STARTTLS for port 587
    if (smtpPort === 587 && ehloResponse.includes('STARTTLS')) {
      console.log('[SMTP] Starting TLS')
      await client.starttls()
      await client.startTls(smtpHost)
      console.log('[SMTP] TLS established, sending EHLO again')
      await client.ehlo('localhost')
    }

    console.log('[SMTP] Authenticating')
    await client.auth(smtpUser, smtpPass)
    console.log('[SMTP] Authenticated successfully')

    console.log('[SMTP] Setting MAIL FROM')
    await client.mailFrom(smtpFrom)

    console.log('[SMTP] Setting RCPT TO')
    await client.rcptTo(recipientEmail)

    console.log('[SMTP] Sending DATA')
    await client.data(mimeMessage)
    console.log('[SMTP] Email sent successfully')

    await client.quit()
  } finally {
    await client.close()
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

    const { recipientEmail, subject, textBody, attachment } = body

    console.log('[SendEmailAttachment] Request:', {
      recipientEmail,
      subject,
      attachmentType: attachment?.type,
      attachmentFileName: attachment?.type === 'pdf' ? attachment.fileName : attachment?.fileName
    })

    // Validate required fields
    if (!recipientEmail || !subject || !textBody || !attachment) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: recipientEmail, subject, textBody, attachment'
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

    // Log SMTP configuration status (without exposing sensitive values)
    console.log('[SendEmailAttachment] SMTP Configuration check:', {
      SMTP_HOST: smtpHost ? `set (${smtpHost})` : 'NOT SET',
      SMTP_PORT: smtpPort,
      SMTP_USER: smtpUser ? `set (${smtpUser})` : 'NOT SET',
      SMTP_PASS: smtpPass ? 'set (hidden)' : 'NOT SET',
      SMTP_FROM: smtpFrom ? `set (${smtpFrom})` : 'NOT SET'
    })

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
      const missing = []
      if (!smtpHost) missing.push('SMTP_HOST')
      if (!smtpUser) missing.push('SMTP_USER')
      if (!smtpPass) missing.push('SMTP_PASS')
      if (!smtpFrom) missing.push('SMTP_FROM')
      console.error('[SendEmailAttachment] Missing SMTP configuration. Missing secrets:', missing.join(', '))
      return new Response(JSON.stringify({
        error: `Email service not configured. Missing: ${missing.join(', ')}. Please contact your administrator.`
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

    // Encode attachment as base64 using Deno's standard library
    const attachmentBase64 = base64Encode(attachmentContent)

    // Build MIME message with plain text body and attachment
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const mimeMessage = [
      `From: ${smtpFrom}`,
      `To: ${recipientEmail}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      textBody,
      ``,
      `--${boundary}`,
      `Content-Type: ${attachmentMimeType}; name="${attachmentFileName}"`,
      `Content-Disposition: attachment; filename="${attachmentFileName}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      attachmentBase64.match(/.{1,76}/g)?.join('\r\n') || attachmentBase64,
      ``,
      `--${boundary}--`,
    ].join('\r\n')

    // Send email
    console.log('[SendEmailAttachment] Sending email to:', recipientEmail)
    await sendSmtpEmail(smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, recipientEmail, mimeMessage)

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

import 'server-only'

// lib/email/provider.ts
// Strategy-pattern email provider abstraction for Campaign Manager

import type { EmailProviderType } from '@/lib/types'

export interface SendEmailParams {
  to:       string
  subject:  string
  html:     string
  text?:    string
  from?:    string
  replyTo?: string
}

export interface SendResult {
  messageId: string
}

export interface EmailProvider {
  name: EmailProviderType
  send(params: SendEmailParams): Promise<SendResult>
}

// -- Resend provider (default) ---------------------------------

class ResendProvider implements EmailProvider {
  name = 'resend' as const
  private apiKey: string
  private defaultFrom: string

  constructor(config: Record<string, unknown>) {
    this.apiKey = (config.apiKey as string) || process.env.RESEND_API_KEY || ''
    this.defaultFrom = (config.from as string) || 'Sentimetrx <campaigns@sentimetrx.ai>'
  }

  async send(params: SendEmailParams): Promise<SendResult> {
    if (!this.apiKey) throw new Error('RESEND_API_KEY not configured')

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     params.from || this.defaultFrom,
        to:       [params.to],
        reply_to: params.replyTo,
        subject:  params.subject,
        html:     params.html,
        text:     params.text,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Resend API error: ${err}`)
    }

    const data = await res.json()
    return { messageId: data.id }
  }
}

// -- SendGrid provider -----------------------------------------

class SendGridProvider implements EmailProvider {
  name = 'sendgrid' as const
  private apiKey: string
  private defaultFrom: string

  constructor(config: Record<string, unknown>) {
    this.apiKey = (config.apiKey as string) || process.env.SENDGRID_API_KEY || ''
    this.defaultFrom = (config.from as string) || 'campaigns@sentimetrx.ai'
  }

  async send(params: SendEmailParams): Promise<SendResult> {
    if (!this.apiKey) throw new Error('SENDGRID_API_KEY not configured')

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: params.to }] }],
        from: { email: params.from || this.defaultFrom },
        reply_to: params.replyTo ? { email: params.replyTo } : undefined,
        subject: params.subject,
        content: [
          ...(params.text ? [{ type: 'text/plain', value: params.text }] : []),
          { type: 'text/html', value: params.html },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`SendGrid API error: ${err}`)
    }

    const messageId = res.headers.get('x-message-id') || crypto.randomUUID()
    return { messageId }
  }
}

// -- AWS SES provider ------------------------------------------

class SESProvider implements EmailProvider {
  name = 'ses' as const
  private defaultFrom: string

  constructor(config: Record<string, unknown>) {
    this.defaultFrom = (config.from as string) || 'campaigns@sentimetrx.ai'
  }

  async send(params: SendEmailParams): Promise<SendResult> {
    // SES requires AWS SDK — lazy require to avoid webpack bundling when not installed
    let ses: any
    try { ses = require('@aws-sdk/client-ses') } catch {
      throw new Error('AWS SES provider requires @aws-sdk/client-ses — run: npm install @aws-sdk/client-ses')
    }
    const client = new ses.SESClient({})

    const command = new ses.SendEmailCommand({
      Source: params.from || this.defaultFrom,
      Destination: { ToAddresses: [params.to] },
      ReplyToAddresses: params.replyTo ? [params.replyTo] : undefined,
      Message: {
        Subject: { Data: params.subject },
        Body: {
          Html: { Data: params.html },
          ...(params.text ? { Text: { Data: params.text } } : {}),
        },
      },
    })

    const result = await client.send(command)
    return { messageId: result.MessageId || crypto.randomUUID() }
  }
}

// -- SMTP provider (via nodemailer) -----------------------------

class SMTPProvider implements EmailProvider {
  name = 'smtp' as const
  private config: Record<string, unknown>

  constructor(config: Record<string, unknown>) {
    this.config = config
  }

  async send(params: SendEmailParams): Promise<SendResult> {
    // Lazy require to avoid webpack bundling when not installed
    let nodemailer: any
    try { nodemailer = require('nodemailer') } catch {
      throw new Error('SMTP provider requires nodemailer — run: npm install nodemailer')
    }
    const transport = nodemailer.createTransport({
      host: this.config.host as string,
      port: (this.config.port as number) || 587,
      secure: (this.config.port as number) === 465,
      auth: {
        user: this.config.user as string,
        pass: this.config.pass as string,
      },
    })

    const info = await transport.sendMail({
      from:    params.from || (this.config.from as string) || 'campaigns@sentimetrx.ai',
      to:      params.to,
      replyTo: params.replyTo,
      subject: params.subject,
      html:    params.html,
      text:    params.text,
    })

    return { messageId: info.messageId }
  }
}

// -- Twilio SMS provider ----------------------------------------

export interface SendSMSParams {
  to:   string
  body: string
  from?: string
}

export interface SMSSendResult {
  messageId: string
}

export class TwilioSMSProvider {
  private accountSid: string
  private authToken: string
  private fromNumber: string

  constructor(config: Record<string, unknown>) {
    this.accountSid = (config.accountSid as string) || process.env.TWILIO_ACCOUNT_SID || ''
    this.authToken = (config.authToken as string) || process.env.TWILIO_AUTH_TOKEN || ''
    this.fromNumber = (config.fromNumber as string) || process.env.TWILIO_PHONE_NUMBER || ''
  }

  async send(params: SendSMSParams): Promise<SMSSendResult> {
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      throw new Error('Twilio SMS not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER')
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`
    const body = new URLSearchParams({
      To: params.to,
      From: params.from || this.fromNumber,
      Body: params.body,
    })

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(this.accountSid + ':' + this.authToken).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Twilio API error: ${err}`)
    }

    const data = await res.json()
    return { messageId: data.sid }
  }
}

export function getSMSProvider(config: Record<string, unknown> = {}): TwilioSMSProvider {
  return new TwilioSMSProvider(config)
}

// Build SMS body with survey link for a respondent
export function buildSMSBody(
  template: string,
  respondent: { email: string; fields: Record<string, string> },
  extras: Record<string, string> = {}
): string {
  return interpolateTemplate(template, respondent, extras)
}

// -- Factory ---------------------------------------------------

export function getEmailProvider(
  providerType: EmailProviderType,
  config: Record<string, unknown> = {}
): EmailProvider {
  switch (providerType) {
    case 'resend':   return new ResendProvider(config)
    case 'sendgrid': return new SendGridProvider(config)
    case 'ses':      return new SESProvider(config)
    case 'smtp':     return new SMTPProvider(config)
    default:         return new ResendProvider(config)
  }
}

// -- Template interpolation ------------------------------------

export function interpolateTemplate(
  template: string,
  respondent: { email: string; fields: Record<string, string> },
  extras: Record<string, string> = {}
): string {
  const vars: Record<string, string> = {
    email: respondent.email,
    ...respondent.fields,
    ...extras,
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '')
}

export function buildSurveyUrl(
  baseUrl: string,
  respondent: { fields: Record<string, string>; recipient_guid?: string },
  hiddenFields: string[]
): string {
  const url = new URL(baseUrl)
  // Embed recipient GUID for tracking
  if (respondent.recipient_guid) {
    url.searchParams.set('rid', respondent.recipient_guid)
  }
  for (const field of hiddenFields) {
    const value = respondent.fields[field]
    if (value) url.searchParams.set(field, value)
  }
  return url.toString()
}

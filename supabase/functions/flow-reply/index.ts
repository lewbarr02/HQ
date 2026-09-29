import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Twilio inbound SMS webhook for the HQ toll-free number. Answers the
// flow-checkin "Still in it?" texts:
//   yes / y / yep / 👍 …        → keep going (silent)
//   no | no 20 | no 1:50[pm]    → end the session now / 20 min ago / at 1:50 (ET)
// Deploy with --no-verify-jwt: Twilio can't send a Supabase JWT, so the
// X-Twilio-Signature check below is the security boundary.

const SUPABASE_URL = 'https://bfgybytjjubdnciraksj.supabase.co'
// Must match the webhook URL configured in Twilio exactly — req.url inside the
// edge runtime is not the public URL, so it can't be used for the signature.
const WEBHOOK_URL = SUPABASE_URL + '/functions/v1/flow-reply'
const TZ = 'America/New_York'

const YES_WORDS = ['y', 'yes', 'yep', 'yeah', 'still', 'ya', '👍', '✅']
// 'stop' is deliberately absent: it's a carrier opt-out keyword on toll-free
// numbers and would unsubscribe Lewis from every HQ text.
const NO_WORDS = ['n', 'no', 'nope', 'done', 'out']
// Twilio handles these itself (opt-out / opt-in / help); stay silent.
const RESERVED = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'start', 'unstop', 'help', 'info']
const HELP_TEXT = "Reply yes or no (e.g. 'no 20' = ended 20 min ago)."

function twiml(message?: string): Response {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = message
    ? '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + esc(message) + '</Message></Response>'
    : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
  return new Response(body, { headers: { 'Content-Type': 'text/xml' } })
}

async function validSignature(authToken: string, signature: string, params: URLSearchParams): Promise<boolean> {
  if (!signature) return false
  const keys = Array.from(new Set(Array.from(params.keys()))).sort()
  let data = WEBHOOK_URL
  for (const k of keys) {
    for (const v of params.getAll(k)) data += k + v
  }
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)))
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

function digits(phone: string): string {
  const d = (phone || '').replace(/\D/g, '')
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d
}

function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return m + 'm'
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'
}

// ET wall-clock parts for an instant.
function etParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') }
}

// ET offset (wall − UTC) in ms at a given instant.
function etOffsetMs(d: Date): number {
  const p = etParts(d)
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000
}

// Convert an ET wall-clock time to a UTC instant (DST-safe).
function etWallToDate(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const off1 = etOffsetMs(new Date(guess))
  let t = guess - off1
  const off2 = etOffsetMs(new Date(t))
  if (off2 !== off1) t = guess - off2
  return new Date(t)
}

// Most recent past occurrence of h:mm (ET). Without am/pm, both 12h readings are tried.
function resolveClock(h: number, mi: number, ampm: string | null, now: Date): Date | null {
  if (mi > 59 || h > 23 || (ampm && (h < 1 || h > 12))) return null
  let hours: number[]
  if (ampm) hours = [(h % 12) + (ampm.startsWith('p') ? 12 : 0)]
  else if (h > 12 || h === 0) hours = [h]
  else hours = [h % 12, (h % 12) + 12]
  const p = etParts(now)
  const yest = new Date(Date.UTC(p.y, p.mo - 1, p.d - 1))
  const days = [
    { y: p.y, mo: p.mo, d: p.d },
    { y: yest.getUTCFullYear(), mo: yest.getUTCMonth() + 1, d: yest.getUTCDate() },
  ]
  let best: Date | null = null
  for (const day of days) {
    for (const hr of hours) {
      const c = etWallToDate(day.y, day.mo, day.d, hr, mi)
      if (c.getTime() <= now.getTime() && (!best || c.getTime() > best.getTime())) best = c
    }
  }
  return best
}

type Parsed = { kind: 'yes' } | { kind: 'no'; endedAt: Date } | { kind: 'reserved' } | { kind: 'unknown' }

function parseReply(raw: string, now: Date): Parsed {
  const text = (raw || '')
    .trim().toLowerCase()
    .replace(/[️\u{1F3FB}-\u{1F3FF}]/gu, '') // emoji variation selectors + skin tones
    .replace(/[.!?,]+$/g, '')
    .trim()
  if (!text) return { kind: 'unknown' }
  if (RESERVED.includes(text)) return { kind: 'reserved' }
  const first = text.split(/\s+/)[0]
  const rest = text.slice(first.length).trim()

  if (YES_WORDS.includes(first) || YES_WORDS.includes(text)) return { kind: 'yes' }
  if (!NO_WORDS.includes(first)) return { kind: 'unknown' }

  if (!rest) return { kind: 'no', endedAt: now }

  let m = rest.match(/^(\d+)\s*(m|min|mins|minute|minutes)?(\s+ago)?$/)
  if (m) return { kind: 'no', endedAt: new Date(now.getTime() - parseInt(m[1], 10) * 60000) }

  m = rest.match(/^(\d+)\s*(h|hr|hrs|hour|hours)(\s+ago)?$/)
  if (m) return { kind: 'no', endedAt: new Date(now.getTime() - parseInt(m[1], 10) * 3600000) }

  m = rest.match(/^(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm|a|p)?$/) || rest.match(/^(?:at\s+)?(\d{1,2})()\s*(am|pm|a|p)$/)
  if (m) {
    const at = resolveClock(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3] || null, now)
    if (at) return { kind: 'no', endedAt: at }
  }
  return { kind: 'unknown' }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const myNumber = Deno.env.get('TWILIO_TO_NUMBER')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authToken || !myNumber || !serviceKey) return new Response('not configured', { status: 500 })

  const params = new URLSearchParams(await req.text())
  if (!(await validSignature(authToken, req.headers.get('x-twilio-signature') || '', params))) {
    return new Response('invalid signature', { status: 403 })
  }
  if (digits(params.get('From') || '') !== digits(myNumber)) return twiml()

  const now = new Date()
  const parsed = parseReply(params.get('Body') || '', now)
  if (parsed.kind === 'reserved') return twiml()

  const sb = createClient(SUPABASE_URL, serviceKey)
  const { data: active, error } = await sb.from('flow_sessions')
    .select('*').eq('user_id', 'lewis').is('ended_at', null)
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return twiml()
  if (!active) return twiml('No active flow session.')

  if (parsed.kind === 'yes') {
    await sb.from('flow_sessions')
      .update({ awaiting_reply: false, unanswered_count: 0 })
      .eq('id', active.id).is('ended_at', null)
    return twiml()
  }

  if (parsed.kind === 'no') {
    const startMs = new Date(active.started_at).getTime()
    const endMs = Math.min(now.getTime(), Math.max(startMs, parsed.endedAt.getTime()))
    const { data: updated } = await sb.from('flow_sessions')
      .update({ ended_at: new Date(endMs).toISOString(), end_source: 'reply', awaiting_reply: false })
      .eq('id', active.id).is('ended_at', null)
      .select('id')
    if (!updated || !updated.length) return twiml('No active flow session.')
    return twiml('Logged. Flow lasted ' + fmtDur(endMs - startMs) + '.')
  }

  return twiml(HELP_TEXT)
})

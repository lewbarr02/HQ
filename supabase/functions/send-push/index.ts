import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Web Push implementation in Deno (no external library needed)
// Uses SubtleCrypto for ECDH + AES-GCM encryption

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from(rawData, c => c.charCodeAt(0))
}

function uint8ArrayToUrlBase64(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function createVapidJwt(audience: string, subject: string, privateKeyB64u: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { aud: audience, exp: now + 43200, sub: subject }

  const enc = new TextEncoder()
  const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const signingInput = `${headerB64}.${payloadB64}`

  const keyBytes = urlBase64ToUint8Array(privateKeyB64u)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  )

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    enc.encode(signingInput)
  )

  const sigB64 = uint8ArrayToUrlBase64(new Uint8Array(signature))
  return `${signingInput}.${sigB64}`
}

async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  subject: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const url = new URL(subscription.endpoint)
    const audience = `${url.protocol}//${url.host}`
    const jwt = await createVapidJwt(audience, subject, vapidPrivateKey)

    // Encrypt payload using ECDH + AES-128-GCM (Web Push encryption)
    const authBytes = urlBase64ToUint8Array(subscription.keys.auth)
    const p256dhBytes = urlBase64ToUint8Array(subscription.keys.p256dh)

    // Generate ephemeral key pair
    const ephemeral = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
    )
    const ephemeralPublicRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey)

    // Import recipient public key
    const recipientKey = await crypto.subtle.importKey(
      'raw', p256dhBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
    )

    // Derive shared secret
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: recipientKey }, ephemeral.privateKey, 256
    )

    // HKDF: derive content encryption key and nonce
    const enc = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))

    const prkKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits'])

    // PRK
    const prkInfo = new Uint8Array([...enc.encode('Content-Encoding: auth\0'), 0x01])
    const prk = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: authBytes, info: prkInfo }, prkKey, 256
    )

    const prkKey2 = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits'])
    const serverPublicRaw = new Uint8Array(ephemeralPublicRaw)
    const context = new Uint8Array([
      ...enc.encode('P-256\0'),
      0x00, p256dhBytes.length,
      ...p256dhBytes,
      0x00, serverPublicRaw.length,
      ...serverPublicRaw,
    ])

    const cekInfo = new Uint8Array([...enc.encode('Content-Encoding: aesgcm\0'), ...enc.encode('P-256\0'), ...context])
    const nonceInfo = new Uint8Array([...enc.encode('Content-Encoding: nonce\0'), ...enc.encode('P-256\0'), ...context])

    const cekBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo }, prkKey2, 128
    )
    const nonceBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, prkKey2, 96
    )

    const cek = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt'])
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonceBits, tagLength: 128 },
      cek,
      enc.encode(payload)
    )

    const body = new Uint8Array(encrypted)
    const headers: Record<string, string> = {
      'Authorization': `vapid t=${jwt},k=${vapidPublicKey}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      'Encryption': `salt=${uint8ArrayToUrlBase64(salt)}`,
      'Crypto-Key': `dh=${uint8ArrayToUrlBase64(serverPublicRaw)};p256ecdsa=${vapidPublicKey}`,
      'Content-Encoding': 'aesgcm',
      'TTL': '86400',
    }

    const resp = await fetch(subscription.endpoint, { method: 'POST', headers, body })
    return { ok: resp.status === 201 || resp.status === 200, status: resp.status }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

const NOTIFICATION_SCHEDULES = {
  morning: {
    title: '🌅 Good morning, Lewis!',
    body: "Time to start your morning routine. Let's crush today.",
    tag: 'hq-morning',
    requireInteraction: true,
  },
  midday: {
    title: '☀️ Midday check-in',
    body: 'Quick pulse — how\'s the day going? Hit your job app yet?',
    tag: 'hq-midday',
    requireInteraction: false,
  },
  evening: {
    title: '🌙 Evening routine time',
    body: 'Wind down and get that CPAP on. Tomorrow starts tonight.',
    tag: 'hq-evening',
    requireInteraction: true,
  },
  habit_nudge: {
    title: '📋 Habit check',
    body: "Don't let today slip by — a few habits still need checking off.",
    tag: 'hq-habits',
    requireInteraction: false,
  },
  job_nudge: {
    title: '💼 Job application reminder',
    body: "You haven't logged a job app today yet. 1 a day keeps the search moving.",
    tag: 'hq-job',
    requireInteraction: false,
  },
  test: {
    title: '✅ HQ Notifications work!',
    body: "You'll get morning, midday, and evening nudges from now on.",
    tag: 'hq-test',
    requireInteraction: false,
  },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://bfgybytjjubdnciraksj.supabase.co'
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { type } = await req.json().catch(() => ({ type: 'test' }))
    const notif = NOTIFICATION_SCHEDULES[type as keyof typeof NOTIFICATION_SCHEDULES] || NOTIFICATION_SCHEDULES.test

    const sb = createClient(supabaseUrl, supabaseServiceKey || '')
    const { data: subs, error } = await sb.from('push_subscriptions').select('*')

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const payload = JSON.stringify({
      title: notif.title,
      body: notif.body,
      tag: notif.tag,
      requireInteraction: notif.requireInteraction,
      url: '/',
    })

    const results = await Promise.all((subs || []).map(async (row: Record<string, unknown>) => {
      if (!row.endpoint || !row.p256dh || !row.auth) return { ok: false, error: 'missing fields' }
      const sub = {
        endpoint: row.endpoint as string,
        keys: { p256dh: row.p256dh as string, auth: row.auth as string },
      }
      const result = await sendWebPush(sub, payload, vapidPublicKey, vapidPrivateKey, 'mailto:lewbarrapps@gmail.com')
      // Remove dead subscriptions (410 = gone, 404 = not found)
      if (result.status === 410 || result.status === 404) {
        await sb.from('push_subscriptions').delete().eq('user_id', row.user_id)
      }
      return result
    }))

    const sent = results.filter(r => r.ok).length
    return new Response(JSON.stringify({ sent, total: results.length, type }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

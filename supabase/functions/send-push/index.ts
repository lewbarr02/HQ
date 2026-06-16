import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    body: "Quick pulse — how's the day going? Hit your job app yet?",
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
  'flow-checkin': {
    title: '⚡ Still in flow?',
    body: 'Tap to check in — or log that the window closed.',
    tag: 'hq-flow',
    requireInteraction: true,
  },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://bfgybytjjubdnciraksj.supabase.co'
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      || Deno.env.get('SUPABASE_ANON_KEY')
      || 'sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4'

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    webpush.setVapidDetails('mailto:lewbarrapps@gmail.com', vapidPublicKey, vapidPrivateKey)

    const body = await req.json().catch(() => ({}))
    const { type = 'test', subscription } = body
    const notif = NOTIFICATION_SCHEDULES[type as keyof typeof NOTIFICATION_SCHEDULES] || NOTIFICATION_SCHEDULES.test

    const payload = JSON.stringify({
      title: notif.title,
      body: notif.body,
      tag: notif.tag,
      requireInteraction: notif.requireInteraction,
      url: '/',
    })

    // If subscription passed directly from frontend, use it. Otherwise fall back to DB.
    let subs: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }> = []

    if (subscription?.endpoint) {
      subs = [subscription]
    } else {
      const sb = createClient(supabaseUrl, supabaseKey)
      const { data, error } = await sb.from('push_subscriptions').select('*')
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      subs = (data || []).map((row: Record<string, unknown>) => ({
        endpoint: row.endpoint as string,
        keys: { p256dh: row.p256dh as string, auth: row.auth as string },
      })).filter(s => s.endpoint)
    }

    const results = await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload)
        return { ok: true }
      } catch (err: unknown) {
        return { ok: false, error: String(err) }
      }
    }))

    const sent = results.filter(r => r.ok).length
    return new Response(JSON.stringify({ sent, total: results.length, type, errors: results.filter(r => !r.ok) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

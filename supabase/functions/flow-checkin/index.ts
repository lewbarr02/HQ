import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Called by pg_cron every 5 min (hq-flow-checkin). For each active flow session
// whose next_check_at has passed: send "Still in it?" via send-sms, or — after
// 2 unanswered checks — auto-close it at the time of the last check.
// SILENCE = YES: an unanswered check never ends a session on its own.

const SUPABASE_URL = 'https://bfgybytjjubdnciraksj.supabase.co'
const FALLBACK_KEY = 'sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4'
const CHECK_INTERVAL_MIN = 45
const MAX_UNANSWERED = 2

function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return m + 'm'
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'
}

async function sendSms(message: string, secret: string): Promise<boolean> {
  try {
    const resp = await fetch(SUPABASE_URL + '/functions/v1/send-sms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + FALLBACK_KEY,
        'x-hq-secret': secret,
      },
      body: JSON.stringify({ type: 'flow', message }),
    })
    const data = await resp.json().catch(() => ({}))
    return !!data.sent
  } catch (_e) {
    return false
  }
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

serve(async (req) => {
  const secret = Deno.env.get('HQ_INTERNAL_SECRET') || ''
  if (!secret || req.headers.get('x-hq-secret') !== secret) {
    return json({ error: 'unauthorized' }, 401)
  }

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceKey) return json({ error: 'service role key missing' }, 500)
    const sb = createClient(SUPABASE_URL, serviceKey)

    const now = new Date()
    const nowIso = now.toISOString()
    const { data: due, error } = await sb
      .from('flow_sessions')
      .select('*')
      .is('ended_at', null)
      .lte('next_check_at', nowIso)
    if (error) return json({ error: error.message }, 500)

    const results: unknown[] = []
    for (const s of due || []) {
      if (s.awaiting_reply) {
        const missed = (s.unanswered_count || 0) + 1
        if (missed >= MAX_UNANSWERED) {
          const endedAt = s.last_check_at || nowIso
          // Guard on next_check_at so overlapping cron runs can't double-process.
          const { data: closed } = await sb.from('flow_sessions')
            .update({ ended_at: endedAt, end_source: 'auto_close', unanswered_count: missed, awaiting_reply: false })
            .eq('id', s.id).is('ended_at', null).eq('next_check_at', s.next_check_at)
            .select('id')
          if (closed && closed.length) {
            const dur = fmtDur(new Date(endedAt).getTime() - new Date(s.started_at).getTime())
            const sent = await sendSms('Closed your flow session — logged ' + dur + '. 🌊', secret)
            results.push({ id: s.id, action: 'auto_close', sent })
          }
          continue
        }
        s.unanswered_count = missed
      }

      const nextCheck = new Date(now.getTime() + CHECK_INTERVAL_MIN * 60000).toISOString()
      const { data: claimed } = await sb.from('flow_sessions')
        .update({
          last_check_at: nowIso,
          awaiting_reply: true,
          next_check_at: nextCheck,
          unanswered_count: s.unanswered_count || 0,
        })
        .eq('id', s.id).is('ended_at', null).eq('next_check_at', s.next_check_at)
        .select('id')
      if (!claimed || !claimed.length) continue
      const elapsed = fmtDur(now.getTime() - new Date(s.started_at).getTime())
      const sent = await sendSms('Still in it? 🌊 (' + elapsed + ' so far)', secret)
      results.push({ id: s.id, action: 'check', unanswered: s.unanswered_count || 0, sent })
    }

    return json({ ok: true, processed: results })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

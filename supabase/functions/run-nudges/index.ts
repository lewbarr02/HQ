import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = 'https://bfgybytjjubdnciraksj.supabase.co'
const FALLBACK_KEY = 'sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4'

// Real America/New_York local time — correctly handles EDT/EST without hardcoded UTC offsets.
function nowInET(): { hhmm: string; dow: number; dateKey: string } {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  const hhmm = `${hour}:${get('minute')}`
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dow = dowMap[get('weekday')] ?? new Date().getDay()
  return { hhmm, dow, dateKey }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || FALLBACK_KEY
    const sb = createClient(SUPABASE_URL, supabaseKey)

    const { data: nudges, error } = await sb.from('nudges').select('*').eq('user_id', 'lewis').eq('active', true)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })

    const { hhmm, dow, dateKey } = nowInET()
    const [curH, curM] = hhmm.split(':').map(Number)
    const curMinutes = curH * 60 + curM

    const toSend = (nudges || []).filter((n: any) => {
      if (n.last_sent_date === dateKey) return false
      if (!Array.isArray(n.days) || !n.days.includes(dow)) return false
      const [h, m] = (n.time || '00:00').split(':').map(Number)
      const nudgeMinutes = h * 60 + m
      return curMinutes >= nudgeMinutes && curMinutes < nudgeMinutes + 5
    })

    const results = []
    for (const n of toSend) {
      const pushResp = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + FALLBACK_KEY },
        body: JSON.stringify({
          type: 'hardstop',
          custom: {
            title: (n.emoji ? n.emoji + ' ' : '') + n.title,
            body: n.body,
            tag: 'hq-nudge-' + n.id,
            requireInteraction: !!n.require_interaction,
          },
        }),
      })
      const pushResult = await pushResp.json()

      let smsResult = null
      if (n.require_interaction) {
        const smsResp = await fetch(SUPABASE_URL + '/functions/v1/send-sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + FALLBACK_KEY },
          body: JSON.stringify({ message: (n.emoji ? n.emoji + ' ' : '') + n.title + ' — ' + n.body }),
        })
        smsResult = await smsResp.json().catch(() => null)
      }

      await sb.from('nudges').update({ last_sent_date: dateKey }).eq('id', n.id)
      results.push({ id: n.id, title: n.title, pushResult, smsResult })
    }

    return new Response(JSON.stringify({ checked: (nudges || []).length, sent: results.length, results, etTime: hhmm, etDow: dow }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})

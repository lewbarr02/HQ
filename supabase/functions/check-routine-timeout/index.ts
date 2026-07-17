import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = 'https://bfgybytjjubdnciraksj.supabase.co'
const FALLBACK_KEY = 'sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4'
const TIMEOUT_MINUTES = 20

// Built-in routines that follow the {date}/{date}_start/{date}_done log convention.
const BUILTIN_ROUTINES: Array<{ logKey: string; label: string; emoji: string }> = [
  { logKey: 'routineLog', label: 'Morning Routine', emoji: '☀️' },
  { logKey: 'eveningLog', label: 'Evening Routine', emoji: '🌙' },
  { logKey: 'middayLog', label: 'Midday Routine', emoji: '🌤️' },
  { logKey: 'postWorkoutLog', label: 'Post-Workout Routine', emoji: '🏋️' },
  { logKey: 'cleaningLog', label: 'Cleaning Routine', emoji: '🧹' },
  { logKey: 'golfLog', label: 'Golf Wind-Down', emoji: '⛳' },
  { logKey: 'carWashLog', label: 'Car Wash Routine', emoji: '🚗' },
]

function etParts(d: Date): { dateKey: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  return { dateKey: `${get('year')}-${get('month')}-${get('day')}` }
}

// Minutes since midnight, in ET, for "now".
function etNowMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  return parseInt(hour, 10) * 60 + parseInt(get('minute'), 10)
}

// Parses "2:30 PM" style strings (same format the app writes for _start/_done timestamps)
function parseTimeToMin(str: string): number | null {
  if (!str) return null
  const m = str.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const mn = parseInt(m[2], 10)
  const ap = m[3].toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + mn
}

interface Overdue { id: string; label: string; emoji: string; elapsedMin: number }

function checkLog(dateKey: string, nowMin: number, log: any, id: string, label: string, emoji: string): Overdue | null {
  if (!log) return null
  const start = log[dateKey + '_start']
  const done = log[dateKey + '_done']
  const isTest = log[dateKey + '_test']
  if (!start || done || isTest) return null
  const startMin = parseTimeToMin(start)
  if (startMin == null) return null
  let elapsed = nowMin - startMin
  if (elapsed < 0) elapsed += 1440 // crossed midnight
  if (elapsed < TIMEOUT_MINUTES) return null
  return { id, label, emoji, elapsedMin: elapsed }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || FALLBACK_KEY
    const sb = createClient(SUPABASE_URL, supabaseKey)

    const wantedKeys = BUILTIN_ROUTINES.map(r => r.logKey).concat(['customRoutines', 'customRoutineLogs'])
    const { data, error } = await sb.from('hq_data').select('key,value').eq('user_id', 'lewis').in('key', wantedKeys)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })

    const dataMap: Record<string, any> = {}
    for (const row of data || []) dataMap[row.key] = row.value

    const now = new Date()
    const { dateKey } = etParts(now)
    const nowMin = etNowMinutes(now)

    const overdue: Overdue[] = []

    for (const r of BUILTIN_ROUTINES) {
      const hit = checkLog(dateKey, nowMin, dataMap[r.logKey], r.logKey, r.label, r.emoji)
      if (hit) overdue.push(hit)
    }

    const customRoutines: Array<{ id: string; name: string; emoji?: string }> = dataMap.customRoutines || []
    const customRoutineLogs: Record<string, any> = dataMap.customRoutineLogs || {}
    for (const cr of customRoutines) {
      const hit = checkLog(dateKey, nowMin, customRoutineLogs[cr.id], 'custom-' + cr.id, cr.name, cr.emoji || '⭐')
      if (hit) overdue.push(hit)
    }

    const results = []
    for (const o of overdue) {
      const title = `${o.emoji} ${o.label} not completed`
      const body = `Started ${o.elapsedMin} min ago and still open. Get back to it or close it out.`

      const pushResp = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + FALLBACK_KEY },
        body: JSON.stringify({
          type: 'hardstop',
          custom: { title, body, tag: 'hq-routine-timeout-' + o.id, requireInteraction: true },
        }),
      })
      const pushResult = await pushResp.json().catch(() => null)

      const smsResp = await fetch(SUPABASE_URL + '/functions/v1/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + FALLBACK_KEY },
        body: JSON.stringify({ message: `${title} — ${body}` }),
      })
      const smsResult = await smsResp.json().catch(() => null)

      results.push({ id: o.id, label: o.label, elapsedMin: o.elapsedMin, pushResult, smsResult })
    }

    return new Response(JSON.stringify({ checked: BUILTIN_ROUTINES.length + customRoutines.length, overdue: results.length, results, dateKey, nowMin }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})

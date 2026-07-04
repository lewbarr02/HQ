import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = 'https://bfgybytjjubdnciraksj.supabase.co'
const FALLBACK_KEY = 'sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4'
const WARN_MINUTES_BEFORE_END = 10

function nowInET(): { hhmm: string; dateKey: string } {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  return { hhmm: `${hour}:${get('minute')}`, dateKey: `${get('year')}-${get('month')}-${get('day')}` }
}

// Parses "2:30 PM" style strings (same format the app's priorities/timeline use)
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

function fmtMinAsTime(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  const ap = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}

interface Block { id: string; label: string; startMin: number; endMin: number }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || FALLBACK_KEY
    const sb = createClient(SUPABASE_URL, supabaseKey)

    const { data, error } = await sb.from('hq_data').select('key,value').eq('user_id', 'lewis')
      .in('key', ['scheduledLog', 'priorities', 'scheduleWarningsSent'])
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })

    const dataMap: Record<string, any> = {}
    for (const row of data || []) dataMap[row.key] = row.value

    const { hhmm, dateKey } = nowInET()
    const [curH, curM] = hhmm.split(':').map(Number)
    const curMinutes = curH * 60 + curM

    const scheduledLog = dataMap.scheduledLog || {}
    const todaysScheduled: Block[] = (scheduledLog[dateKey] || []).map((b: any) => ({
      id: 'sched-' + b.schedId,
      label: b.label,
      startMin: b.minute,
      endMin: b.minute + b.durationMin,
    }))

    const priorities = dataMap.priorities || []
    const todaysPriorities: Block[] = priorities
      .filter((p: any) => p.time && !p.done)
      .map((p: any) => {
        const startMin = parseTimeToMin(p.time)
        if (startMin == null) return null
        return { id: 'pri-' + p.id, label: p.name, startMin, endMin: startMin + (p.duration || 45) }
      })
      .filter(Boolean) as Block[]

    const allBlocks = todaysScheduled.concat(todaysPriorities).sort((a, b) => a.startMin - b.startMin)

    const warningsSentAll = dataMap.scheduleWarningsSent || {}
    const warningsSentToday = new Set<string>(warningsSentAll[dateKey] || [])

    const toWarn = allBlocks.filter(b => {
      if (warningsSentToday.has(b.id)) return false
      const warnAt = b.endMin - WARN_MINUTES_BEFORE_END
      return curMinutes >= warnAt && curMinutes < warnAt + 5
    })

    const results = []
    for (const b of toWarn) {
      const next = allBlocks.filter(x => x.startMin >= b.endMin).sort((a, b2) => a.startMin - b2.startMin)[0]
      const nextText = next
        ? `Up next: ${next.label} at ${fmtMinAsTime(next.startMin)}.`
        : `Nothing scheduled after this — plan your next move.`

      const pushResp = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + FALLBACK_KEY },
        body: JSON.stringify({
          type: 'hardstop',
          custom: {
            title: `⏳ ${WARN_MINUTES_BEFORE_END} min left: ${b.label}`,
            body: `Start winding this down. ${nextText}`,
            tag: 'hq-schedule-' + b.id,
            requireInteraction: false,
          },
        }),
      })
      const pushResult = await pushResp.json().catch(() => null)
      warningsSentToday.add(b.id)
      results.push({ id: b.id, label: b.label, pushResult })
    }

    // Persist dedup state, pruning old dates so this key doesn't grow unbounded
    const nextWarningsAll: Record<string, string[]> = { [dateKey]: Array.from(warningsSentToday) }
    await sb.from('hq_data').upsert(
      { user_id: 'lewis', key: 'scheduleWarningsSent', value: nextWarningsAll, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    )

    return new Response(JSON.stringify({ checked: allBlocks.length, warned: results.length, results, etTime: hhmm }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = 'https://bfgybytjjubdnciraksj.supabase.co'
const FALLBACK_KEY = 'sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4'

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysSince(dateStr: string, todayKey: string): number {
  const d = new Date(dateStr + 'T12:00:00')
  const t = new Date(todayKey + 'T12:00:00')
  return Math.floor((t.getTime() - d.getTime()) / 86400000)
}

function currentWeekDates(todayKey: string): string[] {
  const t = new Date(todayKey + 'T12:00:00')
  const dow = t.getDay()
  const monday = new Date(t)
  monday.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1))
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    dates.push(dateKey(d))
  }
  return dates
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || FALLBACK_KEY
    const sb = createClient(SUPABASE_URL, supabaseKey)

    const { data, error } = await sb.from('hq_data').select('key,value').eq('user_id', 'lewis')
      .in('key', ['habits', 'habitLog', 'projectItems', 'projectLog', 'projectData'])
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    }

    const dataMap: Record<string, any> = {}
    for (const row of data || []) dataMap[row.key] = row.value

    const habits = dataMap.habits || []
    const habitLog = dataMap.habitLog || {}
    const projectItems = dataMap.projectItems || []
    const projectLog = dataMap.projectLog || {}
    const projectData = dataMap.projectData || null

    const todayKey = dateKey(new Date())
    const flags: string[] = []

    // Daily habits: flag if not done today or yesterday
    for (const h of habits) {
      const freq = h.freq || 'daily'
      if (freq !== 'daily') continue
      let lastDone: number | null = null
      for (let back = 0; back <= 30; back++) {
        const d = new Date(todayKey + 'T12:00:00')
        d.setDate(d.getDate() - back)
        const key = dateKey(d)
        if (habitLog[key] && habitLog[key][h.id]) { lastDone = back; break }
      }
      if (lastDone === null || lastDone >= 2) {
        flags.push(`${h.name} (${lastDone === null ? 'never logged' : lastDone + 'd since'})`)
      }
    }

    // Weekly habits: flag if not done this week and it's Friday or later
    const weekDates = currentWeekDates(todayKey)
    const isoDow = (() => { const dow = new Date(todayKey + 'T12:00:00').getDay(); return dow === 0 ? 7 : dow })()
    for (const h of habits) {
      if (h.freq !== 'weekly') continue
      const doneThisWeek = weekDates.some(dk => habitLog[dk] && habitLog[dk][h.id])
      if (!doneThisWeek && isoDow >= 5) {
        flags.push(`${h.name} (not done this week)`)
      }
    }

    // Active projects: flag if untouched 7+ days (matches in-app neglect threshold)
    for (const p of projectItems) {
      if (p.status === 'done') continue
      let daysSinceLogged: number | null = null
      const dates = Object.keys(projectLog).sort().reverse()
      for (const dk of dates) {
        const entry = projectLog[dk] && projectLog[dk][p.id]
        if (entry && (entry.note || entry === true)) { daysSinceLogged = daysSince(dk, todayKey); break }
      }
      if (daysSinceLogged === null || daysSinceLogged >= 7) {
        flags.push(`${p.name} (${daysSinceLogged === null ? 'never logged' : daysSinceLogged + 'd since'})`)
      }
    }

    // The Moonshot project
    if (projectData && projectData.lastAction) {
      const d = daysSince(projectData.lastAction, todayKey)
      if (d >= 7) flags.push(`Moonshot Project (${d}d since last action)`)
    }

    if (flags.length === 0) {
      return new Response(JSON.stringify({ sent: 0, flags: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const shown = flags.slice(0, 4)
    const bodyText = shown.join(' · ') + (flags.length > 4 ? ` · +${flags.length - 4} more` : '')

    const pushResp = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + FALLBACK_KEY },
      body: JSON.stringify({ type: 'hardstop', custom: { title: '😴 Momentum check', body: bodyText, tag: 'hq-momentum' } }),
    })
    const pushResult = await pushResp.json()

    return new Response(JSON.stringify({ flags, pushResult }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})

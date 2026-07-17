import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = 'https://bfgybytjjubdnciraksj.supabase.co'
const FALLBACK_KEY = 'sb_publishable_8_szpJNSWkEdZPdl0fDJpw_U8Q0DWg4'

function etDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function etTimeString(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}

// Called by an iOS Shortcuts automation on alarm-stop, so it can fire silently
// (no phone unlock / app open required) and capture the real moment Lewis wakes,
// rather than whenever he eventually opens HQ and starts the morning routine.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || FALLBACK_KEY
    const sb = createClient(SUPABASE_URL, supabaseKey)

    const now = new Date()
    const dateKey = etDateKey(now)
    const timeStr = etTimeString(now)

    const { data, error } = await sb.from('hq_data').select('value').eq('user_id', 'lewis').eq('key', 'wakeLog').maybeSingle()
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })

    const wakeLog = (data && data.value) || {}
    const existing = wakeLog[dateKey]

    if (!existing) {
      wakeLog[dateKey] = timeStr
      const { error: upErr } = await sb.from('hq_data').upsert(
        { user_id: 'lewis', key: 'wakeLog', value: wakeLog, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' }
      )
      if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: true, dateKey, time: existing || timeStr, firstLogToday: !existing }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})

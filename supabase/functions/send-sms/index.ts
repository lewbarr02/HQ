import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SMS_SCHEDULES: Record<string, string> = {
  morning:    '🌅 Good morning Lewis! Time to start your morning routine. Let\'s crush today.',
  midday:     '☀️ Midday check-in — how\'s the day going? Hit your job app yet?',
  evening:    '🌙 Evening routine time. Wind down and get that CPAP on. Tomorrow starts tonight.',
  job_nudge:  '💼 You haven\'t logged a job app today yet. 1 a day keeps the search moving.',
  habit_nudge:'📋 Don\'t let today slip — a few habits still need checking off.',
  test:       '✅ HQ SMS works! You\'ll get morning, midday, and evening nudges.',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')
    const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER') // toll-free number, e.g. +18885551234
    const toNumber   = Deno.env.get('TWILIO_TO_NUMBER')   // Lewis's cell

    if (!accountSid || !authToken || !fromNumber || !toNumber) {
      return new Response(JSON.stringify({ error: 'Twilio env vars not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json().catch(() => ({}))
    const { type = 'test', message: customMessage } = body
    const message = customMessage || SMS_SCHEDULES[type] || SMS_SCHEDULES.test

    const params = new URLSearchParams({ To: toNumber, From: fromNumber, Body: message })
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    )

    const data = await resp.json()
    if (data.sid) {
      return new Response(JSON.stringify({ sent: true, sid: data.sid, type }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } else {
      return new Response(JSON.stringify({ sent: false, error: data.message || data.code, type }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

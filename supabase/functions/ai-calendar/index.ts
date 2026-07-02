import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `You are Lewis Barr's AI calendar assistant inside HQ, his personal life operating system.

CONTEXT ON LEWIS:
- 43 years old, severe ADHD — visual processor, out of sight is out of mind
- Wake goal: 5:00 AM (natural wake is 7:30-7:45 AM). Sleep apnea — CPAP compliance is foundational
- Actively job searching (minimum 1 application/day) — this MUST stay visible and protected, never quietly dropped
- Also running "the Moonshot Project," his life's work — ambitious but must not crowd out job search or non-negotiables
- Wants an AI that spots patterns and flags when ambition outruns the day

YOUR JOB: Given a snapshot of Lewis's day (locked items, calendar events, flexible priorities, today's flow-state sessions, and what changed), propose a revised schedule for the rest of the day.

Use FLOW STATE HISTORY (if present) to judge his actual focus pattern today — a long, high-intensity session means he's locked in and demanding work should follow that same rhythm; a short or interrupted one means focus is fragile right now and you should favor lighter, lower-stakes flexible items next rather than stacking another demanding block immediately.

HARD RULES:
1. Items marked "locked" (routines, CPAP, non-negotiables, calendar events) are FIXED. Never move, resize, or remove them. You may only flag if one is at risk (e.g. still not done and time is running out).
2. Job search (daily application) is a protected non-negotiable. If it isn't done yet today, it must appear in your suggestions with a real time slot — never silently dropped in favor of project work.
3. Never schedule anything in the past relative to the current time provided.
4. Leave reasonable buffer between blocks — don't pack minute-to-minute.
5. Only reschedule the flexible items provided. Do not invent new tasks.
6. Be direct and specific in your reasoning — Lewis has ADHD, so explanations should be short, concrete, and free of fluff.

Always return valid JSON only, in exactly this format:
{ summary, suggestions: [{ id, name, suggestedTime, durationMin, reasoning }], atRisk: [], notes }`

function extractJSON(text: string): any | null {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch (_) {}
  }
  const fencedPlain = text.match(/```\s*([\s\S]*?)\s*```/)
  if (fencedPlain) {
    try { return JSON.parse(fencedPlain[1]) } catch (_) {}
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch (_) {}
  }
  return null
}

function buildReschedulePrompt(bundle: any, userNote: string): string {
  const lockedLines = (bundle.locked || []).map((b: any) =>
    `- ${b.label}${b.start ? ` — ${b.start}${b.end ? ' to ' + b.end : ''}` : ''}${b.done === false ? ' (NOT YET DONE)' : ''}`
  ).join('\n') || 'None'

  const calLines = (bundle.calendarEvents || []).map((ev: any) =>
    `- ${ev.title} — ${ev.start} to ${ev.end}`
  ).join('\n') || 'None'

  const flexLines = (bundle.flexibleItems || []).map((p: any) =>
    `- id:${p.id} "${p.name}"${p.category ? ` (${p.category})` : ''}${p.time ? ` — currently ${p.time}` : ' — unscheduled'}${p.durationMin ? `, ${p.durationMin}min` : ''}`
  ).join('\n') || 'None'

  const nonNeg = bundle.nonNegotiables || {}

  const flowLines = (bundle.flowHistory || []).map((f: any) => {
    const parts = [`${f.start}${f.end ? ' - ' + f.end : ' (still ongoing)'}`, `${f.durationMin}min`]
    if (f.peakIntensity) parts.push(`peak intensity ${f.peakIntensity}/5`)
    if (f.quality) parts.push(`ended quality ${f.quality}/5`)
    return `- ${parts.join(', ')}`
  }).join('\n') || 'No flow sessions logged today'

  return `TODAY: ${bundle.date || 'unknown'}
CURRENT TIME: ${bundle.currentTime || 'unknown'}

NON-NEGOTIABLE STATUS:
- Morning routine: ${nonNeg.morningRoutineDone ? 'done' : 'NOT done'}
- CPAP last night: ${nonNeg.cpapLastNight ? 'logged' : 'NOT logged'}
- Job application today: ${nonNeg.jobApplicationDoneToday ? 'done' : 'NOT done'}

FLOW STATE TODAY:
${flowLines}

LOCKED (fixed — do not move):
${lockedLines}

CALENDAR EVENTS (fixed — do not move):
${calLines}

FLEXIBLE ITEMS (may be rescheduled):
${flexLines}

WHAT CHANGED (from Lewis):
${userNote || 'No specific change described — just give a fresh look at the rest of the day.'}

Propose new times for the flexible items only, working around everything locked. If the job application is not yet done, it must be one of the suggestions with a real time slot before end of day. Flag anything at risk of not happening in "atRisk".`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { type, dayBundle, userNote } = body

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: corsHeaders })

    // ── type: reschedule ───────────────────────────────────────────────────
    if (!type || type === 'reschedule') {
      if (!dayBundle) return new Response(JSON.stringify({ error: 'No dayBundle' }), { status: 400, headers: corsHeaders })

      const userPrompt = buildReschedulePrompt(dayBundle, userNote || '')

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })
      if (!resp.ok) {
        const err = await resp.text()
        return new Response(JSON.stringify({ error: err }), { status: resp.status, headers: corsHeaders })
      }
      const data = await resp.json()
      const rawText = data.content?.[0]?.text || ''
      const parsed = extractJSON(rawText)

      return new Response(JSON.stringify({ content: rawText, parsed }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown type: ' + type }), { status: 400, headers: corsHeaders })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})

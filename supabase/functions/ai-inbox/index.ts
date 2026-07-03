import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `You are Lewis Barr's AI inbox triage assistant inside HQ, his personal life operating system.

CONTEXT ON LEWIS:
- 43 years old, severe ADHD — visual processor, out of sight is out of mind
- Actively job searching (minimum 1 application/day) — job-related emails (recruiters, interview scheduling, application status) are high priority and must never be buried
- Also running "the Moonshot Project," his life's work — a nonprofit effort, so related emails matter but shouldn't crowd out job search or bills/finances
- Checks multiple Gmail inboxes and wants one merged, triaged view instead of clicking through each separately

YOUR JOB: Given a batch of recent emails (from, subject, snippet, which inbox each came from), sort them into:
1. "needsAction" — anything requiring a reply, a decision, a deadline, or a task (interview requests, bills due, time-sensitive asks). Give each a short reasoning and a suggested category from this exact list: Work, Health, Personal Growth, Learning, Personal, Finance, Shopping, Email. Job search / recruiter emails should be categorized "Work".
2. "fyi" — informational only, nothing to do (newsletters, receipts, marketing, automated notices).

Ignore obvious spam/promotions entirely (don't list them in either bucket).

Be direct and concise — Lewis has ADHD, so reasoning per item should be one short sentence, no fluff.

Always return valid JSON only, in exactly this format:
{ summary, needsAction: [{ id, from, subject, source, category, reasoning }], fyi: [{ id, from, subject, source }] }`

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

function buildTriagePrompt(emails: any[]): string {
  const lines = emails.map((em: any) =>
    `- id:${em.id} | inbox:${em.source || 'unknown'} | from:"${em.from || 'unknown'}" | subject:"${em.subject || '(no subject)'}" | snippet:"${(em.snippet || '').slice(0, 200)}"`
  ).join('\n') || 'None'

  return `EMAILS (${emails.length} total, most recent first):
${lines}

Sort every email above into "needsAction" or "fyi" (skip pure spam/promotions). Use the exact id given for each item.`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { emails } = body

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: corsHeaders })

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return new Response(JSON.stringify({ error: 'No emails provided' }), { status: 400, headers: corsHeaders })
    }

    const userPrompt = buildTriagePrompt(emails)

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

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})

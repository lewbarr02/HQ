import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `You are the personal strength and physique coach for Lewis Barr.

ATHLETE PROFILE:
- Lewis Barr, 43 years old, 20+ years of consistent lifting experience (intermediate-to-advanced)
- Current: 5'9", 205 lbs, ~18% body fat
- Goals: 190 lbs, 12% body fat
- Aesthetic priority (V-taper): Lateral deltoid width, upper chest fullness, arm development (bicep peak + tricep size). These muscle groups receive protected volume even in a caloric deficit.

COACHING STYLE:
- Talk to Lewis as an experienced lifter. Direct, specific, no fluff.
- Always explain the reasoning behind recommendations. Never over-explain basics Lewis already knows.
- Hold the aesthetic goal as the north star alongside numerical targets.
- Numbers inform the program; the photo reveals the reality.
- Lewis has ADHD — be structured, clear, and concrete in your output.`

function epley1RM(weight: number, reps: number): number {
  return Math.round(weight * (1 + reps / 30))
}

function extractJSON(text: string): any | null {
  // Try ```json ... ``` block first
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch (_) {}
  }
  // Try ``` ... ``` (no lang tag)
  const fencedPlain = text.match(/```\s*([\s\S]*?)\s*```/)
  if (fencedPlain) {
    try { return JSON.parse(fencedPlain[1]) } catch (_) {}
  }
  // Find the outermost { ... } in the text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch (_) {}
  }
  return null
}

function buildOnboardingPrompt(answers: any, calculated1RMs: Record<string, number>): string {
  const liftLines = Object.entries(calculated1RMs).map(([k, v]) => `- ${k}: ~${v} lbs estimated 1RM`).join('\n')
  return `Create a complete, personalized training program for Lewis based on his intake answers.

INTAKE:
- Training days/week: ${answers.daysPerWeek}
- Session length: ${answers.sessionLength}
- Preferred days: ${(answers.preferredDays || []).join(', ') || 'Not specified'}
- Training location: ${answers.location}
- Equipment notes: ${answers.equipmentNotes || 'N/A'}
- Current injuries: ${answers.injuries || 'None'}
- Movements to avoid: ${answers.avoidMovements || 'None'}
- Joint issues: ${(answers.jointIssues || []).join(', ') || 'None'}
- Schedule flexibility: ${answers.scheduleFlexibility}
- Off-limit days: ${answers.offLimitDays || 'None'}

ESTIMATED 1RMs (Epley formula from working set data):
${liftLines || '- No strength data provided — use conservative starting weights'}

Design a program that:
1. Fits ${answers.daysPerWeek} days/week within ${answers.sessionLength} sessions
2. Protects lateral delt and upper chest volume as non-negotiable priorities
3. Uses the estimated 1RMs to set week 1 working weights at ~70-75% (conservative baseline)
4. Respects all injury/movement constraints
5. Progressive overload structure with clear progression logic

Return ONLY a JSON object (no markdown outside the code block):
\`\`\`json
{
  "reasoning": "2-3 paragraphs explaining why this split and structure fits Lewis's goals, aesthetic priorities, and baseline strength. Reference the actual numbers. Be direct.",
  "programMeta": {
    "split": "Upper/Lower",
    "daysPerWeek": 4,
    "priorityMuscles": ["lateral delts", "upper chest", "arms"],
    "weekNumber": 1
  },
  "program": {
    "split": "Upper/Lower",
    "deloadWeek": false,
    "weekNumber": 1,
    "generatedAt": "${new Date().toISOString()}",
    "days": [
      {
        "dayLabel": "Upper A",
        "scheduledDay": "Monday",
        "focus": ["lateral delts", "upper chest"],
        "exercises": [
          {
            "name": "Incline Barbell Press",
            "sets": 4,
            "reps": "6-8",
            "percentOf1RM": 75,
            "targetWeight": 185,
            "lastWeight": null,
            "lastReps": null,
            "lastLogged": null,
            "notes": "3-second eccentric, full stretch at bottom"
          }
        ]
      }
    ]
  }
}
\`\`\``
}

function buildCheckinPrompt(data: any): string {
  return `Weekly check-in analysis for Lewis.

TRAINING THIS WEEK:
- Sessions completed: ${data.sessionsCompleted} / ${data.programmedDays} programmed
- Workout energy: ${data.energy}/5 ${['','(running on empty)','(below average)','(average)','(above average)','(felt strong all week)'][data.energy] || ''}
- Lingering soreness (2+ days): ${data.soreness || 'None'}
- Pain or joint issues: ${data.pain || 'None'}

BODY:
- Weight this morning: ${data.weight} lbs
- Sleep quality: ${data.sleepQuality}/5
- CPAP compliance: ${data.cpapCompliance}

WORKOUT LOG (last 7 days):
${data.workoutSummary || 'No sessions logged'}

CURRENT PROGRAM:
${JSON.stringify(data.currentProgram || {}, null, 2)}

NUTRITION (last 7 days avg):
${data.macroSummary || 'No nutrition data logged'}

MORNING ROUTINE STREAK: ${data.morningStreak || 'Unknown'}

BODY WEIGHT TREND (last 4 entries):
${data.weightTrend || 'No prior weigh-ins'}

OPEN NOTES:
${data.openNotes || 'None'}

${data.hasPhoto ? 'A progress photo has been included. Assess lateral delt width, upper chest fullness, and arm development specifically. Be honest — if progress is not yet visible, say so and explain the timeline.' : 'No photo this week.'}

Return ONLY a JSON object:
\`\`\`json
{
  "weeklySnapshot": "2-3 sentences: weight trend, sessions vs programmed, macro compliance if tracked",
  "whatWorking": "1-2 specific observations tied to logged data or photo. Not generic praise.",
  "whatNeedsAttention": "1-2 specific items with reasoning and what to do about them",
  "photoAssessment": ${data.hasPhoto ? '"2-3 sentences on V-taper progress: lateral delt width, upper chest fullness, arm development. Specific and honest."' : 'null'},
  "programAdjustments": "What changes next week and exactly why. If nothing changes, say the program holds and why.",
  "focusCue": "One specific actionable cue — technical (e.g. slow the eccentric on incline press) or behavioral (e.g. hit lateral raises before pressing — protect what matters most)",
  "updatedProgram": {}
}
\`\`\`
For updatedProgram: copy the current program structure with any weight/rep adjustments for the coming week. Increment weekNumber. Apply +5 lbs upper body / +10 lbs lower body progression where all reps were hit at target weight.`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { type, prompt, onboardingAnswers, checkinData, photo } = body

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: corsHeaders })

    // ── type: analysis (existing behavior, unchanged) ──────────────────────
    if (!type || type === 'analysis') {
      if (!prompt) return new Response(JSON.stringify({ error: 'No prompt' }), { status: 400, headers: corsHeaders })
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!resp.ok) {
        const err = await resp.text()
        return new Response(JSON.stringify({ error: err }), { status: resp.status, headers: corsHeaders })
      }
      const data = await resp.json()
      const content = data.content?.[0]?.text || ''
      return new Response(JSON.stringify({ content }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── type: onboarding ───────────────────────────────────────────────────
    if (type === 'onboarding') {
      if (!onboardingAnswers) return new Response(JSON.stringify({ error: 'No onboardingAnswers' }), { status: 400, headers: corsHeaders })

      const lifts = onboardingAnswers.strengthLifts || {}
      const calculated1RMs: Record<string, number> = {}
      for (const [lift, data] of Object.entries(lifts) as [string, any][]) {
        const w = parseFloat(data.weight)
        const r = parseFloat(data.reps)
        if (w > 0 && r > 0) calculated1RMs[lift] = epley1RM(w, r)
      }

      const userPrompt = buildOnboardingPrompt(onboardingAnswers, calculated1RMs)
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
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

      let parsed: any = null
      parsed = extractJSON(rawText)

      return new Response(JSON.stringify({ content: rawText, parsed, calculated1RMs }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── type: weekly-checkin ───────────────────────────────────────────────
    if (type === 'weekly-checkin') {
      if (!checkinData) return new Response(JSON.stringify({ error: 'No checkinData' }), { status: 400, headers: corsHeaders })

      const userPrompt = buildCheckinPrompt({ ...checkinData, hasPhoto: !!photo })
      const contentBlocks: any[] = []

      if (photo) {
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: photo },
        })
      }
      contentBlocks.push({ type: 'text', text: userPrompt })

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: contentBlocks }],
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

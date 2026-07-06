import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

function imgMediaType(b64: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (b64.startsWith('iVBOR')) return 'image/png'
  if (b64.startsWith('R0lGO')) return 'image/gif'
  if (b64.startsWith('UklGR')) return 'image/webp'
  return 'image/jpeg'
}

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

const CHECKIN_SYSTEM_PROMPT = `You are Lewis's personal AI fitness consultant. You have deep context about him that never changes:

LEWIS'S PROFILE:
- 43 years old, severe ADHD
- 5'9", current: 205 lbs / 18% BF, goal: 190 lbs / 12% BF
- 20+ years training, college football background
- Trains Mon/Tue/Thu/Fri at LA Fitness and YMCA
- Left rotator cuff tear — never had surgery. No pain but left shoulder is weaker than right
- All pressing movements use DUMBBELLS only — no barbell pressing except OHP which is also being transitioned to dumbbell
- Naturally bottom-heavy — retains leg mass easily, legs are maintenance only
- Lagging body part: biceps — dedicated strict volume every session
- No heavy back squats — max 135 lbs by choice. Uses Hex Bar for RDL instead of straight bar

GOAL PHYSIQUE:
- Reference: Michael B Jordan, Omari Hardwick, Reggie Bush
- Athletic V-taper. Wide capped shoulders, visible lats, defined upper chest, full arms
- NOT a bodybuilder look — lean, athletic, proportional

PRIORITY MUSCLE ORDER THIS BLOCK:
1. Lateral Delts — high volume, both upper days
2. Lats/Back Width — V-taper is currently hidden under body fat
3. Upper Chest — incline DB work
4. Biceps — dedicated volume, strict form, progressive overload every week
5. Legs — maintenance only

CURRENT PROGRAM:
Upper/Lower | 4 days | Mon/Tue/Thu/Fri

EQUIPMENT NOTES:
- LA Fitness leg press sled = 103 lbs (not standard 75)
- LA Fitness hex bar = ~45 lbs
- YMCA hex bar = ~35 lbs
- All plate math must account for correct sled/bar weight

PROGRESSIVE OVERLOAD RULES:
- Hit top of rep range on ALL sets → increase weight next week
- Hit bottom of rep range → stay at same weight
- Missed reps or form broke down → stay or drop 5 lbs
- Biceps and lateral delts: increase in 2.5-5 lb increments only
- Compound movements: 5 lb increments
- Legs: 10 lb increments

YOUR JOB ON WEEKLY CHECK-IN:
1. Analyze the workout log data sent — actual weights and reps logged
2. Apply progressive overload rules to every exercise
3. Return an updated program JSON with new targetWeights for the coming week
4. Write a brief coaching note (2-3 sentences) as focusCue
5. Increment weekNumber by 1
6. Flag anything that looks off — missed sessions, weight drops, lagging movements

Always return valid JSON in exactly this format:
{ summary, weeklyFocus, updatedProgram: { split, weekNumber, days: [...] }, focusCue }`

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

function buildOnboardingPrompt(answers: any, calculated1RMs: Record<string, number>, hasPhoto = false, hasReferencePhotos = false): string {
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

${hasReferencePhotos ? 'Reference photos of Lewis\'s ideal physique have been included first (before the Day 1 photo). Study them carefully — note the specific aesthetic traits: shoulder width and delt capping, chest-to-waist taper, arm size and shape, overall proportions. These define the target. Your aestheticTarget field must describe these traits concretely so they can be referenced in every future coaching session.' : 'No reference photos provided.'}

${hasPhoto ? 'A Day 1 photo of Lewis\'s current physique follows the reference photos. Compare his current state to the target and note the gaps in your reasoning.' : 'No Day 1 photo provided.'}

Design a program that:
1. Fits ${answers.daysPerWeek} days/week within ${answers.sessionLength} sessions
2. Protects lateral delt and upper chest volume as non-negotiable priorities
3. Uses the estimated 1RMs to set week 1 working weights at ~70-75% (conservative baseline)
4. Respects all injury/movement constraints
5. Progressive overload structure with clear progression logic

WEIGHT RULE — CRITICAL: Every exercise MUST have a specific numeric targetWeight. Never leave targetWeight as null.
- For exercises with an estimated 1RM: use ~70-75% of that 1RM
- For isolation exercises without 1RM data (lateral raises, cable flyes, curls, pushdowns, etc.): estimate a realistic starting weight for an intermediate-to-advanced 43-year-old male lifter with 20+ years of experience. Use real-world typical working weights (e.g. lateral raises 20-30lbs, cable flyes 30-40lbs per side, pushdowns 50-70lbs, curls 35-50lbs). Conservative but not insulting.

Return ONLY a JSON object (no markdown outside the code block):
\`\`\`json
{
  "aestheticTarget": "${hasReferencePhotos ? '3-4 sentences describing the specific traits from the reference photos: exact delt width and shape, chest fullness and shelf, arm development, waist taper. Concrete and visual — this text will be referenced in every future coaching session.' : 'null'}",
  "reasoning": "2-3 paragraphs explaining why this split and structure fits Lewis's goals, aesthetic priorities, and baseline strength. If reference photos were provided, reference the target physique traits. Be direct.",
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

function buildCheckinPrompt(data: any, nextWeekNumber: number): string {
  // Format raw workout log into a structured, per-exercise breakdown
  let rawLogSection = 'No sessions logged this week'
  if (data.workoutLogRaw && Object.keys(data.workoutLogRaw).length > 0) {
    const lines: string[] = []
    for (const [date, sessions] of Object.entries(data.workoutLogRaw) as [string, any[]][]) {
      for (const session of sessions) {
        lines.push(`\n${date}${session.programDay ? ' — ' + session.programDay : ''}:`)
        if (session.exercises && session.exercises.length > 0) {
          for (const ex of session.exercises) {
            const weightStr = ex.weight ? `${ex.weight} lbs` : 'no weight logged'
            const repsStr = ex.reps ? `x${ex.reps}` : ''
            const setsStr = ex.sets ? `${ex.sets} sets` : ''
            lines.push(`  • ${ex.name}: ${setsStr} @ ${weightStr} ${repsStr}`.trim())
          }
        } else if (session.note) {
          lines.push(`  • ${session.note}`)
        }
      }
    }
    rawLogSection = lines.join('\n')
  }

  return `Weekly check-in for Lewis. Coming week will be Week ${nextWeekNumber}.
${data.aestheticTarget ? `
TARGET PHYSIQUE:
${data.aestheticTarget}
` : ''}

TRAINING THIS WEEK:
- Sessions completed: ${data.sessionsCompleted} / ${data.programmedDays} programmed
- Workout energy: ${data.energy}/5 ${['','(running on empty)','(below average)','(average)','(above average)','(felt strong all week)'][data.energy] || ''}
- Lingering soreness (2+ days): ${data.soreness || 'None'}
- Pain or joint issues: ${data.pain || 'None'}

BODY:
- Weight this morning: ${data.weight} lbs
- Sleep quality: ${data.sleepQuality}/5
- CPAP compliance: ${data.cpapCompliance}

WORKOUT LOG — RAW EXERCISE DATA (use this to apply progressive overload rules):
${rawLogSection}

WORKOUT SUMMARY (context/notes):
${data.workoutSummary || 'No sessions logged'}

APPLE WATCH DATA (last 7 days):
${data.watchSummary || 'No watch data uploaded'}

CURRENT PROGRAM (Week ${data.currentProgram?.weekNumber || 1}):
${JSON.stringify(data.currentProgram || {}, null, 2)}

NUTRITION (last 7 days):
${data.macroSummary || 'No nutrition data logged'}

MORNING ROUTINE STREAK: ${data.morningStreak || 'Unknown'}

BODY WEIGHT TREND (last 4 entries):
${data.weightTrend || 'No prior weigh-ins'}

OPEN NOTES:
${data.openNotes || 'None'}

${data.hasPhoto ? 'A progress photo has been included. Assess lateral delt width, upper chest fullness, and arm development specifically. Be honest.' : 'No photo this week.'}

Apply your progressive overload rules to every exercise in the raw log above. The updatedProgram MUST have weekNumber set to ${nextWeekNumber}.

Return ONLY a JSON object:
\`\`\`json
{
  "weeklySnapshot": "2-3 sentences: weight trend, sessions vs programmed, macro compliance if tracked",
  "whatWorking": "1-2 specific observations tied to logged data. Not generic praise.",
  "whatNeedsAttention": "1-2 specific items with reasoning and what to do about them",
  "photoAssessment": ${data.hasPhoto ? '"2-3 sentences on V-taper progress: lateral delt width, upper chest fullness, arm development. Specific and honest."' : 'null'},
  "programAdjustments": "List every exercise where weight changed and why, based on the progressive overload rules.",
  "focusCue": "One specific actionable cue for the coming week — technical or behavioral",
  "updatedProgram": {}
}
\`\`\`
For updatedProgram: copy the full current program structure, update targetWeight on every exercise per the overload rules, and set weekNumber to ${nextWeekNumber}.`
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

      const refPhotos: string[] = body.referencePhotos || []
      const userPrompt = buildOnboardingPrompt(onboardingAnswers, calculated1RMs, !!photo, refPhotos.length > 0)
      const onboardingContent: any[] = []

      // Reference photos first so Claude sees the target before reading intake
      for (const refB64 of refPhotos) {
        onboardingContent.push({ type: 'image', source: { type: 'base64', media_type: imgMediaType(refB64), data: refB64 } })
      }
      // Then Day 1 photo
      if (photo) {
        onboardingContent.push({ type: 'image', source: { type: 'base64', media_type: imgMediaType(photo), data: photo } })
      }
      onboardingContent.push({ type: 'text', text: userPrompt })

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: onboardingContent }],
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

      const nextWeekNumber = ((checkinData.currentProgram?.weekNumber) || 1) + 1
      const userPrompt = buildCheckinPrompt({ ...checkinData, hasPhoto: !!photo }, nextWeekNumber)
      const contentBlocks: any[] = []

      if (photo) {
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: imgMediaType(photo), data: photo },
        })
      }
      contentBlocks.push({ type: 'text', text: userPrompt })

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          system: CHECKIN_SYSTEM_PROMPT,
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
      if (parsed?.updatedProgram) parsed.updatedProgram.weekNumber = nextWeekNumber

      return new Response(JSON.stringify({ content: rawText, parsed }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── type: extract-watch-screenshot ────────────────────────────────────
    if (type === 'extract-watch-screenshot') {
      if (!photo) return new Response(JSON.stringify({ error: 'No photo provided' }), { status: 400, headers: corsHeaders })

      const extractPrompt = `This is a screenshot from an Apple Watch workout summary. Extract all visible workout data and return it as JSON.

Return ONLY this JSON object (no other text):
\`\`\`json
{
  "workoutType": "e.g. Strength Training, HIIT, Outdoor Run, etc.",
  "date": "YYYY-MM-DD if visible, otherwise null",
  "duration": "total workout duration in minutes as a number, or null",
  "activeCalories": "active/move calories burned as a number, or null",
  "totalCalories": "total calories burned as a number, or null",
  "avgHeartRate": "average heart rate in BPM as a number, or null",
  "maxHeartRate": "max heart rate in BPM as a number, or null",
  "distance": "distance in miles as a number if shown, or null",
  "confidence": "high | medium | low — how clearly you could read the data"
}
\`\`\`
If a value is not visible in the screenshot, use null. Numbers only (no units in the values).`

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: imgMediaType(photo), data: photo } },
              { type: 'text', text: extractPrompt },
            ]
          }],
        }),
      })
      if (!resp.ok) {
        const err = await resp.text()
        return new Response(JSON.stringify({ error: err }), { status: resp.status, headers: corsHeaders })
      }
      const data = await resp.json()
      const rawText = data.content?.[0]?.text || ''
      const parsed = extractJSON(rawText)
      return new Response(JSON.stringify({ parsed }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Unknown type: ' + type }), { status: 400, headers: corsHeaders })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})

# HQ — Project Context for Claude

## What is HQ
HQ is Lewis's personal life operating system — a single PWA (Progressive Web App) that replaces the 7-10 apps he currently uses to manage his life. The core problem it solves: Lewis has severe ADHD and is a visual processor. Out of sight = out of mind. HQ is the one place where everything is visible.

**Live URL:** Deployed via Cloudflare Pages, auto-deploys from GitHub repo `lewbarr02/HQ` on push to `main`.

**Tech stack:** Single file — `index.html`. Pure HTML + vanilla JS + React 18 (CDN). No JSX, no build tools, no bundler. React via `React.createElement` aliased as `e()`. Hooks via destructuring. All state persists to `localStorage` via `save(k,v)` / `load(k)` helpers that prefix keys with `hq_`.

---

## Who Lewis Is

- **43 years old**, married, 1-year-old child
- **Severe ADHD** — visual learner, starts many projects, loses momentum, forgets constantly
- **Super ambitious, delusional optimist** — sets big lofty goals with full confidence
- Currently employed but **actively job searching** (minimum 1 application/day — must be protected from being crowded out)
- **The Moonshot Project**: a nonprofit to solve gun violence by recreating the American transportation system around guns (3 nonprofits + 1 for-profit + 1 VC fund). Currently ~80% done with marketing materials. Next phase = recruiting. This is his life's work.
- **Wake time goal**: 5:00 AM (natural wake is 7:30–7:45 AM). Has sleep apnea — CPAP compliance at night is foundational.
- **Fitness goals**: 190 lbs, 12% body fat

**What HQ must do for him:**
1. Visual routines with checklists (morning + evening, midday coming)
2. Visual trend tracking — what's working, what's slipping
3. Keep job search AND project both visible — don't let project crowd out job search
4. Momentum warnings — flag when habits/projects haven't been touched in X days
5. Be the "second set of eyes" — AI that spots patterns and flags when ambition outruns the day

---

## Technical Architecture

### File structure
```
HQ/
  index.html      ← THE entire app (~3500+ lines)
  sw.js           ← Service worker for PWA
  .claude/
    launch.json   ← Preview server config (port 3456, npx serve .)
```

### Key constants (top of index.html)
```js
const ACCENT = "#00C6FF"   // cyan
const PURPLE = "#7B2FFF"
const MUTED  = "#8E8EAA"
const TEXT   = "#1A1833"
const CARD2  = "#F0F2F8"
const BORDER = "rgba(100,80,220,0.18)"
const NIGHT  = "#4F46E5"   // evening routine color
const NIGHT2 = "#7C3AED"
```

### Storage pattern
```js
save('keyName', value)      // writes to localStorage as hq_keyName
load('keyName')             // reads back, returns null if missing
```

### Responsive layout
- **Narrow (<768px)**: bottom nav bar
- **Wide (≥768px)**: left sidebar (72px). Detected via `isWide` state + resize listener.
- CSS: `@media(min-width:768px){#root{max-width:none;margin:0;}}`

### App state (all in main `App` component)
| State var | Storage key | Description |
|-----------|-------------|-------------|
| `habits` | `habits` | Habit definitions |
| `habitLog` | `habitLog` | Daily habit completions |
| `routineLog` | `routineLog` | Morning routine data (all keys prefixed by date) |
| `morningItems` | `morningItems` | Morning checklist items |
| `wakeLog` | `wakeLog` | Wake times by date |
| `eveningLog` | `eveningLog` | Evening routine data |
| `eveningItems` | `eveningItems` | Evening checklist items |
| `cpapLog` | `cpapLog` | CPAP compliance by date |
| `jobLog` | `jobLog` | Job applications by date (numeric count) |
| `projectData` | `projectData` | `{phase, percent, lastAction}` |
| `workoutLog` | `workoutLog` | Fitness workout sessions by date |
| `areasData` | `areasData` | Life areas tasks/notes |
| `goals` | `goals` | Goals list |
| `projects` | `projects` | Projects list |
| `timeLog` | `timeLog` | Time tracking |
| `notes` | `notes` | Notes |
| `groceries` | `groceries` | Grocery list |
| `brainDump` | `brainDump` | Brain dump text |

### routineLog key structure (morning)
```
routineLog[date]           = { itemId: true/false, ... }  // checked items
routineLog[date+'_done']   = "7:32 AM"                    // completion time
routineLog[date+'_start']  = "6:45 AM"                    // start time
routineLog[date+'_partial']= true                         // completed with skips
routineLog[date+'_blockers']= { itemId: "reason" }        // blocker notes
routineLog[date+'_test']   = true                         // test run flag
routineLog[date+'_energy'] = 1-5                          // energy rating
routineLog[date+'_focus']  = "string"                     // #1 focus for the day
```
Evening log uses same structure with `eveningLog`.

---

## Navigation Structure

### Bottom nav / Sidebar tabs
- `today` — Home / TodayScreen
- `areas` — Life areas
- `goals` — Goals & projects
- `time` — Time tracking
- `more` — Opens overlay with: Fitness, Grocery List, Notes, Review, Import/Export Data

### Phase-based full-screen flows (override the main layout)
Morning routine: `morningPhase` state — `'done' | 'greeting' | 'checklist' | 'complete' | 'checkin' | 'history'`
Evening routine: `eveningPhase` state — `'done' | 'greeting' | 'checklist' | 'complete' | 'history'`

---

## Features Built

### Home Screen (TodayScreen)
- **Header**: "Hi Lewis." + date + AM streak badge + morning routine ✓ badge
- **Morning / Evening routine buttons**: Start + 📊 History for each
- **Stat grid**: Habits done, AM streak, Goals, Overall streak
- **Non-Negotiables row**: CPAP (last night), Morning routine status, Job application (tap to log)
- **Job Search card**: Today count, this week, total, 7-day bar chart
- **Project card**: Phase, % progress with +/- buttons, days since last action, "Log action today"
- **Priorities**: Today's top priorities with time + category, add/remove
- **Habit tracker**: Quick-tap habits with streak counter
- **App Hub**: Quick links to Strong, Carb Manager, Gmail, Calendar, Claude, ChatGPT
- **Daily Log**: Scrollable log with date navigator (‹ ›), contains:
  - 🌅 Morning Intention (tap-to-edit energy + #1 focus — does NOT affect routine timestamps)
  - Habits checklist
  - Workout note
  - Nutrition (off/so-so/on point)
  - Water tracker (% of daily gallon)
  - Sleep slider
- **Daily Spark**: Rotating motivational quote

### Morning Routine (4 phases)
1. **Greeting** — welcome + test mode toggle
2. **Checklist** — 8 default items, edit mode (add/remove), blocker modal if incomplete
3. **Complete** — celebration screen with streak + time stats
4. **Check-in** — energy rating (1-5 emoji) + #1 focus for the day
5. **History** — full stats dashboard: current streak, best streak, avg/fastest time, 30-day rate, avg wake time, 30-day dot grid, Morning Intentions log (last 14 days of focus + energy)

Default morning habits: Brush teeth, Morning meds, Hair treatment, Put on watch, Make bed, Fill water jug, Clear texts, Clear emails

### Evening Routine (same structure, purple/indigo theme)
- **Greeting** — moon theme, test mode
- **Checklist** — 10 habits, edit mode, blocker modal
- **Complete** — celebration with streak + time stats
- **History** — streak, best streak, avg/fastest time, 30-day rate, 30-night dot grid

Default evening habits: Brush teeth, Charge phone, Charge watch, Clear texts, Clear email, Workout clothes, Keys, Wallet, Water jug, CPAP

### Fitness Screen (More → Fitness)
Three tabs:
1. **⚖️ Balance** — 14 muscle groups across Push/Pull/Legs/Core, color-coded by days since last worked (green ≤1d, yellow 2-3d, red 5+d/never). Push vs Pull balance bars. Neglected group alert.
2. **+ Log Workout** — date picker, multi-select muscle groups by category, sets count + notes
3. **📋 History** — expandable day entries, delete sessions

Muscle groups tracked:
- Push: Chest, Front Delt, Side Delt, Triceps
- Pull: Lats, Traps, Rear Delt, Biceps
- Legs: Quads, Hamstrings, Glutes, Calves
- Core: Abs, Obliques

---

## Build Backlog (Checklist)

Work through this in order. Check off items as they are completed.

### 💪 FITNESS
- [x] **Muscle group balance tracker** — Log workouts by body part, flag imbalances (e.g. "6 back sessions, 0 chest this month")
- [ ] **Daily macro + calorie logger** — Log meals, track calories, protein, carbs, fat. Daily totals vs targets. Poor man's Carb Manager.
- [ ] **Weekly food pipeline** — Three recurring checkpoints: Plan day, Shop day, Prep day. The logistics system that makes the diet actually work.
- [ ] **Progress photo check-in** — Weekly photo log stored on device. Visual record of body composition over time.
- [ ] **AI fitness coach** — Reads workout balance + food logs + current weight + goal, then gives a written weekly analysis: what to do more of, what to cut, on-track date.

### 📅 CALENDAR & SCHEDULE

**Phase 1 — HQ Day View** *(Day 1 — 1 session, frontend only)*
- [x] **HQ day view** — Visual timeline of the day pulling from existing priorities + routines. Pure index.html, no backend needed.

**Phase 2 — Google Calendar Sync** *(Days 2-4, requires Supabase backend)*
- [ ] **Supabase setup + OAuth scaffolding** *(Day 2)* — Supabase project, Google OAuth app config, token storage.
- [ ] **OAuth flow in HQ** *(Day 2)* — Connect/disconnect Google account, store + refresh access tokens.
- [ ] **Calendar API + event display** *(Day 3)* — Fetch events, overlay on HQ day view alongside priorities.
- [ ] **Conflict detection + time picker integration** *(Day 4)* — Grey out booked times, warn on conflicts, show next free slot in email time picker.

### 🔁 ROUTINES
- [ ] **Midday check-in routine** — A second routine flow midday — quick pulse check, priority reset, catch anything that slipped in the morning.
- [x] **Evening routine + CPAP reminder** — Wind-down checklist. CPAP goes on as a hard step — foundational to 5am wake goal.

### 🔔 NOTIFICATIONS & INTELLIGENCE
- [ ] **Push notifications** — Aggressive, frequent, visual. Requires Supabase backend. Morning alarm, habit nudges, momentum warnings.
- [ ] **Blocker trend analysis** — Data is already being logged when morning routine steps are skipped. Dashboard view to surface what keeps blocking you.

### 📧 EMAIL → HQ
- [x] **Email bookmarklet** — 1-click send any email to Today's Priorities. Auto-detects which Gmail account is active and tags the category (Job Search, Finance, Shopping, Work, Email).
- [x] **Time picker on email toast** — When a task lands from the bookmarklet, show a quick time picker in the toast so it can be scheduled before the toast disappears. No extra steps needed later.

---

## Coding Conventions

- All components use `function ComponentName({props})` syntax
- No JSX — always `e('div', {props}, ...children)`
- `today()` helper returns `YYYY-MM-DD` string
- `calcMorningStreak(routineLog)` — iterates back from today, skips `_test` days
- `calcEveningStreak(eveningLog)` — same pattern
- `calcMorningTime(routineLog, td)` — returns minutes between start and done
- `calcEveningTime(eveningLog, td)` — same for evening
- localStorage items for daily log that aren't in main state: `hq_wn_${date}` (workout note), `hq_nut_${date}` (nutrition), `hq_water_${date}` (water %), `hq_sleep_${date}` (sleep hours)
- Color for evening/night theme: `NIGHT="#4F46E5"`, `NIGHT2="#7C3AED"` (defined as `var` near evening components)
- Fitness category colors: Push=#3B82F6, Pull=#10B981, Legs=#F59E0B, Core=#8B5CF6

## Important behaviors
- Morning Intention block in Daily Log is **tap-to-edit** — saves only `_energy` and `_focus` keys, never touches `_done`, `_start`, or any other routine timing data
- `eveningLog` and `routineLog` are fully separate — stats never mix
- Fitness `workoutLog` structure: `{ 'YYYY-MM-DD': [ { id, groups:[], sets, note } ] }`
- Test mode in routines sets `[date+'_test']=true` which causes streak calculation to skip that day

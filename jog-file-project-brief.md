# Jog File — Project Brief

## Philosophy

- **Today-focused**: Today's view is the center of gravity, not 31 competing columns
- **Manual advancement**: Intentional daily ritual to process yesterday and set up today
- **Continuous timeline**: No artificial monthly ceremonies; dates are just dates
- **Simplicity**: HTMX/Alpine over SPA complexity; it's fundamentally CRUD
- **Recurrences as prompts**: Recurring items suggest tasks, they don't create obligation
- **Staleness awareness**: Surface tasks that keep getting deferred

---

## Tech Stack

- **Backend**: Node.js, Express, MongoDB
- **Templating**: Pug
- **Interactivity**: HTMX + Alpine.js
- **Styling**: Bootstrap
- **Auth**: Simple single-user (password in `.env`, cookie-based session)
- **Timezone**: Hard-coded to `America/Los_Angeles` (Pacific Time)

---

## Core Entities

### Task
- The primary unit of work
- Title, optional description (markdown), optional checklist
- Scheduled date (null = scratch pad)
- Optional time-of-day for appointments
- Status: pending / completed / archived
- Tracks rollover count for staleness
- Can be generated from a recurring template (linked via `generatedFrom`)

### Recurring
- A template that **prompts** you to create tasks on a schedule
- NOT a task itself — it's a task generator
- Patterns: daily, weekly (specific days), monthly (Nth day or last day), interval (every N days)
- When scheduled for today, appears in advancement: "Add to today?" / "Schedule for later" / "Skip"
- Skipping has no penalty — the recurrence will prompt again next scheduled date
- Can pause until a date (vacation mode)
- Monthly patterns on 29/30/31 warn user and fall back to last day of month

### Habit
- A frequency target you're trying to hit (e.g., "Run 3x/week")
- NOT a task — it's a prompt + tracker
- Appears in today view as something you can check off
- Appears in advancement asking "Did you do this yesterday?"
- Tracks completions for streak/count visualization
- Missing a day is fine — no rollover debt, just affects your stats
- Dot-chain display: `●╌╌●╌●╌╌` showing completions within period

### Tracker
- Daily check-in questions for self-observation (not goal-oriented)
- Response types: binary (yes/no), count (0/1/2/3+), scale (1-5)
- Examples: "Did you eat red meat yesterday?", "Alcohol? How many?", "Energy level?"
- Appears in advancement asking about yesterday
- Records responses with date for historical lookup
- Shows simple inline trend (e.g., "3x this week", "avg 2.1")
- No targets, no streaks — just data collection

### Birthday / Annual Event
- Yearly recurrence
- Shows "in N days" countdown as it approaches
- Optional: age tracking, gift ideas, notes

### Sketchy Day
- Marks a date as low-availability
- Visible in month view for planning
- Recurring items can be aware of these when scheduling

---

## Views

### Today (main view)

A unified list of everything for today, freely sortable:

```
TODAY · Wed, Jan 22                    [+ Add]
─────────────────────────────────────────────
⚠️ 3 items to process              [Advance →]
─────────────────────────────────────────────
○ Review inbox                    (from recurrence)
○ Run 3x/week          ●╌●╌╌●╌  2/3    (habit)
○ Pick up dry cleaning                   (task)
○ Call dentist                    ⏱️ 5d  (task, stale)
○ 2:00 PM · Meeting with Alex        (appointment)
○ Water plants                    (from recurrence)
─────────────────────────────────────────────
📊 CHECK-INS
   Red meat yesterday?       [Yes] [No]   3x this week
   Alcohol?                 [0][1][2][3+]  avg 0.8
─────────────────────────────────────────────
🎂 COMING UP
   Mom's birthday in 3 days (turning 65)
─────────────────────────────────────────────
▸ Tomorrow (4)
▸ Fri, Jan 24 (2)
▸ Next 7 days (8)
▸ Later (15)
─────────────────────────────────────────────
▸ Scratch Pad (7)
```

Items are freely orderable within the main list. Appointments with times could optionally sort by time or be manually placed.

### Advancement (daily ritual)

**Blocking flow** — you must complete advancement to access today view.

Processes items one-by-one in this order:

1. **Rollover tasks**: Unfinished tasks from before today
   - "I Did That" → mark complete
   - "Move to Today" → reschedule to today
   - "Schedule for [date]" → reschedule to future date
   - "Send to Scratch Pad" → remove date
   - "Archive" → soft delete

2. **Today's recurrences**: Each recurring template scheduled for today
   - "Add to Today" → create task for today
   - "Schedule for [date]" → create task for future date
   - "Skip" → no task created, will prompt again next occurrence

3. **Yesterday's habits**: For each active habit
   - "Did you [habit] yesterday?" → Yes / No
   - Just recording, no judgment

4. **Yesterday's trackers**: For each active tracker
   - Response buttons based on type (binary/count/scale)

5. **Done** → Today view unlocked

**Escape hatches** for large backlogs:
- "Declare Bankruptcy" → archive all rollover tasks
- "Best Guess" → mark recurring-generated tasks complete, move manual tasks to today

### Month View
- Calendar grid showing all days with their items
- Tasks, recurring-generated tasks, appointments visible
- Sketchy days visually marked
- Useful for planning, not for daily workflow

### Scratch Pad
- Flat list of undated tasks
- Can promote to a scheduled date anytime
- Freely orderable

---

## Item Actions

| Action | Effect |
|--------|--------|
| Complete | Mark done, hide from active lists |
| Move to today | Set date to today |
| Defer | Set to a new date (tomorrow, +N days, specific date) |
| Send to scratch pad | Remove date, move to undated list |
| Archive | Soft delete — removed from lists but preserved in DB |
| Skip (recurrence) | Don't create task, will prompt again next occurrence |
| Reorder | Drag or up/down within the list |
| Edit | Title, description, checklist, date, time |

---

## Staleness

- Track days since creation or last deferral
- Count **active days** (days app was used), not calendar days
- Visual escalation: fresh → mildly stale (⏱️ 5d) → very stale (red) → intervention prompt
- At advancement, stalest items could be highlighted or surfaced first

---

## Implementation Phases

### Phase 0: Foundation
- [ ] Project setup (Express, Mongo, Pug, HTMX, Alpine)
- [ ] Basic layout and styling (Bootstrap)
- [ ] Simple auth (password from `.env`, cookie session)

### Phase 1: MVP — Basic Tickler
- [ ] Task CRUD (title, description, checklist, date)
- [ ] Today view with tasks listed
- [ ] Add task (to today, to a future date, to scratch pad)
- [ ] Complete / archive task
- [ ] Free reordering within day
- [ ] Tomorrow and upcoming sections (collapsed counts, expandable)
- [ ] Scratch pad view
- [ ] Manual advancement flow (one-by-one processing)
- [ ] Defer to tomorrow / to specific date

**Milestone**: Usable replacement for basic Trello tickler workflow

### Phase 2: Recurring & Habits
- [ ] Recurring templates (daily, weekly, monthly, interval)
- [ ] Recurring prompts in advancement flow
- [ ] Generate tasks from recurrence prompts
- [ ] Skip / schedule options for recurrences
- [ ] Pause recurrence until date
- [ ] Habit templates with frequency targets
- [ ] Habit completion tracking
- [ ] Habit prompts in advancement (yesterday)
- [ ] Dot-chain streak visualization

**Milestone**: No more manually recreating repeating tasks

### Phase 3: Polish & Extras
- [ ] Appointments with time-of-day display
- [ ] Birthdays/annual events with countdown
- [ ] Month view
- [ ] Sketchy days
- [ ] Staleness tracking and visual indicators
- [ ] Trackers (check-in questions with history)
- [ ] Mobile-responsive styling
- [ ] PWA basics (optional)

**Milestone**: Full-featured personal organizer

---

## Data Model (MongoDB)

```javascript
// tasks
{
  _id: ObjectId,
  title: String,
  description: String,
  checklist: [{ text: String, done: Boolean }],
  scheduledFor: Date | null,      // null = scratch pad
  timeOfDay: String | null,       // "14:00" for appointments
  createdAt: Date,
  completedAt: Date | null,
  status: 'pending' | 'completed' | 'archived',
  generatedFrom: ObjectId | null, // recurring template ID, if any
  rollovers: Number,
  lastRolloverDate: Date | null,
  position: Number                // for ordering within a day
}

// recurring templates
{
  _id: ObjectId,
  title: String,
  description: String,
  pattern: {
    type: 'daily' | 'weekly' | 'monthly' | 'interval',
    daysOfWeek: [Number],         // 0-6 for weekly
    dayOfMonth: Number,           // 1-31, or -1 for "last day"
    intervalDays: Number,         // for interval type
    intervalAnchor: Date          // start date for interval calculation
  },
  isActive: Boolean,
  pausedUntil: Date | null
}

// habits
{
  _id: ObjectId,
  title: String,
  frequencyTarget: {
    count: Number,                // e.g., 3
    period: 'day' | 'week' | 'month'  // e.g., 'week' → "3x per week"
  },
  isActive: Boolean
}

// habit completions
{
  _id: ObjectId,
  habitId: ObjectId,
  date: Date,
  completedAt: Date
}

// trackers
{
  _id: ObjectId,
  question: String,
  responseType: 'binary' | 'count' | 'scale',
  options: [Number] | null,       // e.g., [0, 1, 2, 3] for count type
  scaleMax: Number | null,        // e.g., 5 for scale type
  isActive: Boolean
}

// tracker responses
{
  _id: ObjectId,
  trackerId: ObjectId,
  date: Date,
  value: Mixed                    // Boolean, Number, or scale value
}

// birthdays / annual events
{
  _id: ObjectId,
  name: String,
  date: { month: Number, day: Number },
  year: Number | null,            // birth year for age calc
  notes: String
}

// sketchy days
{
  _id: ObjectId,
  date: Date,
  reason: String
}

// active days (for staleness calculation)
{
  _id: ObjectId,
  date: Date
}
```

---

## Auth

Simple single-user authentication:
- Password stored in `.env` as `JOG_FILE_PASSWORD`
- Login page accepts password input
- On success, set a session cookie with the password (or hash)
- Middleware validates cookie against `.env` value on every request
- No user registration, no password reset — it's just you

---

## Maybe Someday

Ideas that don't need solving now but might be nice:

- **Pomodoro timer** — built-in focus timer as a lightweight tool
- **Visual separators / sections** — let user insert dividers in the today list to group "Work" vs "Personal" or morning vs afternoon, without needing formal categories

---

## To Kick Off Development

> "I want to build Jog File, a tickler file / personal organizer web app. Here's the project brief. Let's start with Phase 0 and Phase 1."

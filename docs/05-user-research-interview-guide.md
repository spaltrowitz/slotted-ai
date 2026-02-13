# User Research Interview Guide: Social Scheduling Problem Validation

| Field | Value |
|---|---|
| **Goal** | Validate problem, gauge willingness to use calendar-sync solution, identify friction points |
| **Target** | 10–15 interviews with busy young professionals (25–40), your professional network, and active lifestyle communities |








































































































































































































































































































































































6. **Total additional infra cost: $0/month** — all runs on existing PostgreSQL + Node.js5. **Upgrade models as data grows** — gradient boosting at 100+ interactions, neural at 1000+ users4. **Blend AI with rules gradually** — users never notice the transition3. **Train simple models after 20 interactions** — logistic regression, costs nothing2. **Log everything from day 1** — the data is the moat1. **Launch with rule-based scoring** — hand-tuned weights, zero ML infra## Summary---The AI doesn't need to be fancy — it needs to be *useful*. A logistic regression that learns "this user prefers Saturday mornings" is more valuable than a transformer model that hallucinates suggestions.| Custom PyTorch model on GPU | ~$100-500 | Very High || AWS SageMaker | ~$50-100 | High || OpenAI API for each suggestion | ~$50-200 | Medium || **Our approach (scikit-learn + PostgreSQL)** | **~$0** | Low ||---|---|---|| Approach | Monthly Cost (1K users) | Complexity |## Cost Comparison: Our Approach vs. Alternatives---| Global vs. per-user model | Per-user model with global fallback | Personalized when possible, sensible defaults when not || Real-time vs. batch | Batch retraining, real-time inference | Best balance of simplicity and freshness || Training compute | Railway cron job | Free tier handles it; models train in seconds || Feature store | PostgreSQL table | Already have the DB; no need for dedicated feature store || Model serving | JSON weights loaded in Node.js | No Python inference server needed || ML framework | scikit-learn (Python) | Simple, no dependencies, fast training ||---|---|---|| Decision | Choice | Rationale |## Key Technical Decisions---> *"It's been 22 days since you saw Alex (you normally meet every 16 days). Based on your patterns, we'd suggest coffee Saturday 10am at Blue Bottle. Want to ping Alex?"*### Month 6 (Advanced AI - V2)> *"You and Alex usually grab coffee for about an hour on Saturday mornings. There's a perfect slot this Saturday 9:30-10:30am — both of you are 🟢 Open."*### Month 3 (Mature AI)> *"Based on your past meetups, we think Saturday 10am is your best bet with Sarah. You've accepted similar times 4 out of 5 times."*### Month 1 (Early AI)> *"Here are 5 times you and Sarah are both free. We prioritized weekend afternoons since you both prefer those."*### Week 1 (Rule-Based)## What Users Experience---11. **Progressive profiling** — stop asking questions the AI already knows the answer to10. **Surface AI insights** — "You tend to prefer 1hr meetups on weekends"9. **Add per-friend-pair models** — "You and Alex always do Saturday coffee"8. **Upgrade to gradient boosting** — captures non-linear patterns### V2 (Month 4+)7. **Add "Why this time?" tooltip** — show users what the AI considered6. **Update scoring engine** — load AI weights, blend with rule-based score5. **Build model export pipeline** — serialize model weights to JSON in the DB4. **Write Python training script** — reads from `suggestion_events`, trains logistic regression### Post-Launch (Weeks 11-14)3. **Ship rule-based suggestions** — already feels smart from day 12. **Build `suggestion_events` logging** — every suggestion interaction is recorded1. **Build Phase A scoring engine** — pure TypeScript/JavaScript in the backend### V1 Launch (Weeks 1-10)## Implementation Roadmap---Logistic regression and gradient boosting models are small enough to serialize as JSON and load into your Node.js backend. No Python inference server, no GPU, no ML platform needed until you hit thousands of users.**Total additional cost for AI: ~$0/month** at MVP scale.| Feature store | PostgreSQL `suggestion_events` table | $0 (already have DB) || Inference | Node.js service loads weights, does math in-memory | $0 (no GPU needed) || Model storage | PostgreSQL JSON column (model weights are tiny) | $0 (already have DB) || Model training | Python script on Railway (cron job) | ~$0/mo (runs in seconds) ||---|---|---|| Component | Tool | Cost |### Infrastructure (Keep It Cheap)| Global data reaches new threshold | Retrain global model (shared baseline) || User completes 20th interaction | Train their first personalized model || Weekly cron job (Sunday night) | Retrain per-user models with latest data ||---|---|| Trigger | Action |### Retraining Schedule```        return 0.3 * rule_score + 0.7 * ai_score        ai_score = ml_model.predict_proba(features)[1]        # AI-dominant — 30% rules, 70% AI    else:        return 0.7 * rule_score + 0.3 * ai_score        ai_score = ml_model.predict_proba(features)[1]  # probability of acceptance        # Blending phase — 70% rules, 30% AI    elif user_interactions < 50:        return rule_score        # Not enough data — use rules only    if user_interactions < 20:        user_interactions = count_interactions(userA.id)    # Check if we have enough data for AI        rule_score = rule_based_score(slot, userA, userB)  # Phase Adef hybrid_score(slot, userA, userB):```pythonOnce the AI model has enough data, blend it with the rule-based score:### Hybrid Scoring: Rule + AI- Not needed for MVP- Requires 1000+ users to be effective- Learn patterns across users ("Users like you tend to prefer...")**Stage 3 (V2+): Neural collaborative filtering**```)    learning_rate=0.1    max_depth=4,    n_estimators=100,model = GradientBoostingClassifier(# - "This user likes spontaneous plans (low days_until) on weekends but not weekdays"# - "This user likes weekday lunches BUT ONLY with close friends (high meetup_count)"# Same features, but model captures non-linear patterns:from sklearn.ensemble import GradientBoostingClassifier```python**Stage 2: Gradient Boosted Trees (after ~100 interactions globally)**```# Use this as the "AI confidence score" shown in the UI# Output: probability of acceptance (0.0 - 1.0)model.fit(X_train, y_train)model = LogisticRegression()label = action in ('proposed', 'accepted')# Label: 1 if user proposed/accepted, 0 if declined/ignored]    'rule_score',            # 0.0-3.0 (from Phase A)    'days_since_last_met',   # 0-365    'friend_battery_open',   # 0/1    'user_battery_ask_me',   # 0/1    'user_battery_open',     # 0/1    'buffer_after_min',      # 0-480    'buffer_before_min',     # 0-480    'slot_duration_min',     # 30-240    'days_until_slot',       # 1-14    'is_evening',            # 0/1 (5pm-9pm)    'is_weekend',            # 0/1    'day_of_week',           # 0-6    'hour_of_day',           # 0-23features = [# Features per suggestionfrom sklearn.linear_model import LogisticRegression```python**Stage 1: Per-User Logistic Regression (after ~20 interactions)**Start simple and upgrade only when needed:### Model Architecture| User A + User B always meet for coffee | This is a "coffee friendship" | Suggest coffee-length slots (1hr) || User declines same-day suggestions | They prefer advance notice | Boost 3-7 day out suggestions || User overrides 🔴 Recharging on Fridays | They're actually open on Fridays | Suggest Friday despite Recharging status || User always proposes 1hr meetups | Their preferred duration is ~1hr | Default duration = 1hr for this user || User ignores Tuesday evening suggestions | They don't actually like weekday evenings | Reduce score for this window || User always accepts Saturday morning suggestions | They prefer Saturday mornings (even if they didn't select it in onboarding) | Update preference weight ||---|---|---|| Implicit Signal | What It Reveals | Example |### What the Model Learns```);    created_at TIMESTAMPTZ DEFAULT NOW()                                           -- 'declined', 'counter_proposed', 'ignored'    action VARCHAR(20) NOT NULL,       -- 'viewed', 'clicked', 'proposed', 'accepted',     -- THE LABEL (what we're learning to predict)        meetup_count_with_friend INTEGER,    days_since_last_met INTEGER,    buffer_after_min INTEGER,    buffer_before_min INTEGER,    rule_score FLOAT,                  -- score from Phase A    friend_battery VARCHAR(15),    user_battery VARCHAR(15),          -- 'open', 'ask_me'    days_until_slot INTEGER,           -- advance notice    slot_duration_min INTEGER,    slot_window VARCHAR(30),           -- 'weekday_evening', 'weekend_afternoon', etc.    slot_hour INTEGER,                 -- 0-23    slot_day_of_week INTEGER,          -- 0=Mon, 6=Sun    suggested_slot TIMESTAMPTZ NOT NULL,    friend_id UUID NOT NULL,    user_id UUID NOT NULL,    id UUID PRIMARY KEY,CREATE TABLE suggestion_events (```sqlEvery time a user interacts with the app, log an event:### Data Collection (Start from Day 1)The system learns from user behavior to make better suggestions without the user ever updating their preferences manually.### What makes it "AI-like"## Phase B: AI Learning Layer (Builds Over Time)---No ML needed. The scoring weights are hand-tuned based on common sense. It will already feel "smart" because it combines calendar + preferences + Social Battery + social context.### This is enough to ship V1.```    }        'ask_me_options': ask_me_suggestions,        'top_suggestions': open_suggestions,    return {        ask_me_suggestions = [s for s in scored if s['is_ask_me']][:3]    open_suggestions = [s for s in scored if not s['is_ask_me']][:5]    # Separate "Open" suggestions from "Ask Me" suggestions        scored.sort(key=lambda s: s['score'], reverse=True)    scored = [s for s in scored if s is not None]    scored = [score_slot(s, userA, userB, history) for s in mutual_free]    mutual_free = find_overlap(userA.availability, userB.availability)def get_suggestions(userA, userB, history):    }        'reasons': generate_reasons(slot, score_components),  # for "Why this time?" tooltip        'is_ask_me': a_battery == 'ask_me' or b_battery == 'ask_me',        'score': round(score, 2),        'slot': slot,    return {            score *= 0.7   # too far out to commit    else:        score *= 0.9   # still good    elif days_until <= 14:        score *= 1.0   # sweet spot    elif days_until <= 7:        score *= 0.7   # same-day might be too rushed    if days_until < 1:    days_until = (slot.date - today).days    # Step 6: Advance notice (is this too last-minute or too far out?)            score *= 0.6    else:        score *= 0.8    elif min(buffer_before, buffer_after) >= 15:        score *= 1.0    if min(buffer_before, buffer_after) >= 30:  # minutes    buffer_after = userA.next_event_start - slot.end    buffer_before = slot.start - userA.prev_event_end    # Step 5: Buffer quality        score *= social_context.get(slot.social_window, 1.0)    }        'weekday_morning': 0.5,        'weekday_lunch': 0.8,        'weekend_morning': 1.0,        'weekday_evening': 1.1,        'weekend_afternoon': 1.3,        'saturday_evening': 1.4,        'friday_evening': 1.5,    social_context = {    # Step 4: Social context (time-of-day value for social plans)        score *= battery_scores.get((a_battery, b_battery), 0.3)    }        ('ask_me', 'ask_me'): 0.4,        ('ask_me', 'open'): 0.7,        ('open', 'ask_me'): 0.7,        ('open', 'open'): 1.0,    battery_scores = {    b_battery = userB.battery.get(slot.date, userB.default_battery[slot.day_of_week])    a_battery = userA.battery.get(slot.date, userA.default_battery[slot.day_of_week])    # Step 3: Social Battery alignment            score *= 0.5   # neither prefers (still valid, just ranked lower)    else:        score *= 1.0   # one prefers    elif a_prefers or b_prefers:        score *= 2.0   # both prefer this window    if a_prefers and b_prefers:    b_prefers = slot.window in userB.preferred_windows    a_prefers = slot.window in userA.preferred_windows  # e.g., 'weekend_afternoon'    # Step 2: Preference match (biggest weight)        score = 1.0            return None  # hidden entirely    if userA.battery[slot.date] == 'recharging' or userB.battery[slot.date] == 'recharging':        return None    if slot.duration < MIN_DURATION:  # default 45min    # Step 1: Basic eligibilitydef score_slot(slot, userA, userB, history):```python### Scoring Algorithm (Pseudocode)```}  avg_days_between: number | null;  meetup_count: number;  last_met: Date | null;  // From meetup history    userB_battery: Record<string, 'open' | 'ask_me' | 'recharging'>;  userA_battery: Record<string, 'open' | 'ask_me' | 'recharging'>; // date → status  // From Social Battery (current overrides)    userB_preferences: { /* same shape */ };  };    travel_buffer_pref: 'before' | 'after' | 'both' | 'none';    social_battery_defaults: Record<DayOfWeek, 'open' | 'ask_me' | 'recharging'>;    preferred_windows: string[];     // e.g., ['weekday_evening', 'weekend_afternoon']  userA_preferences: {  // From onboarding survey    userB_availability: TimeSlot[];  userA_availability: TimeSlot[];   // free/busy blocks for next 14 days  // From calendar syncinterface ScoringInput {```typescript### Input DataTakes two users' availability + preferences and returns the top 5 times to meet, ranked by quality.### What it does## Phase A: Rule-Based Scoring Engine (Ship at V1 Launch)---You ship Phase A at launch. Phase B layers on top as you collect data. Users never notice the transition — suggestions just get better.| **Phase B: Learned Preferences** | After ~20 interactions per user | ML model trained on user behavior replaces/augments rules | Lightweight ML (logistic regression → gradient boosting) || **Phase A: Rule-Based Scoring** | Day 1 (V1 launch) | Deterministic algorithm using user preferences + calendar data | Pure logic, no ML ||---|---|---|---|| Phase | When | How It Works | Tech |## Overview: Two-Phase Approach| **Format** | 15-minute 1:1 conversations (in-person, Zoom, or phone) |
| **Incentive** | $10 Starbucks gift card or coffee on you |

---

## Interview Structure

### Introduction (1 minute)

> "Hey! I'm working on an app idea to make it easier to schedule regular hangouts with friends. I'd love to hear about your experience with this—there are no right or wrong answers, and I'm genuinely curious about how you currently handle it. This should take about 15 minutes. Cool?"

---

### Section 1: Current Behavior (5 minutes)

**Goal:** Understand existing workflows and pain points

---

**Q1: Walk me through the last time you tried to schedule a hangout with a friend. What did that process look like?**

- *Listen for:* Texting back-and-forth, calendar checking, group chat chaos, giving up
- *Follow-up:* How many messages did it take? How long from first text to confirmed plan?

---

**Q2: How often do you see your close friends? (Weekly, monthly, every few months?)**

- *Listen for:* Frequency and whether they're happy with it
- *Follow-up:* Is that more or less than you'd like? What gets in the way?

---

**Q3: What's most frustrating about coordinating plans with friends?**

- *Listen for:* Time wasted, no one responds, calendar doesn't align, decision fatigue, flaking
- *Probe deeper:* "Tell me more about that..." or "Can you give me an example?"

---

**Q4: Do you use any tools to help schedule with friends currently? (Google Calendar, Doodle, shared calendars, etc.)**

- *Listen for:* What they've tried and why they do/don't stick with it
- *Follow-up:* What do you like/dislike about those tools?

---

### Section 2: Calendar Sharing Willingness (3 minutes)

**Goal:** Test core assumption around privacy and calendar access

---

**Q5: How do you feel about your calendar? Is it something you're comfortable sharing with close friends?**

- *Listen for:* Privacy concerns, calendar sensitivity (work events, personal appointments)
- *Follow-up:* What would make you uncomfortable about sharing it?

---

**Q6: Imagine an app that could see when you and your friends are free—but it ONLY sees "busy" or "free" blocks, never what the event is. Would you be open to trying something like that?**

- *Listen for:* Immediate yes/no/hesitation; what reservations they have
- *Follow-up (if hesitant):* What would you need to know to feel comfortable? What controls would you want?

---

**Q7: What if you could set a "Social Battery" status—like 🟢 Open to plans, 🟡 Ask me, or 🔴 Recharging—so friends know when you're genuinely up for hanging out vs. when you need downtime? Does that change how you'd feel about sharing your calendar?**

- *Listen for:* Whether Social Battery concept resonates; whether it reduces privacy concerns
- *Follow-up:* How would you use each status? Would you set defaults or change it day by day?

---

**Q7b: When you travel, do you usually need a day to recover before or after? Would it be helpful if the app auto-blocked that time for you?**

- *Listen for:* Whether travel buffers resonate; how they handle post-travel social plans
- *Follow-up:* Would you want the day before blocked too (for packing/prep)?

---

### Section 3: Solution Testing (4 minutes)

**Goal:** Gauge interest in proposed features and identify must-haves

---

**Q8: If an app could automatically suggest the best times for you and a friend to meet—based on when you're both free and your preferences (like "I prefer weekends")—would that be useful to you?**

- *Listen for:* Excitement, skepticism, clarifying questions
- *Follow-up:* What would make a "good" suggestion vs. a bad one?

---

**Q9: The app would need your friends to join too for it to work. Realistically, how many of your close friends would you invite to try this with you?**

- *Listen for:* Network effects barrier; whether they'd champion it or just casually mention it
- *Follow-up:* What would make you excited enough to convince your friends to join?

---

**Q10: Would you prefer an app that just shows you when you're both free, or one that proactively suggests "Hey, you and Sarah haven't hung out in 3 weeks—here are some times you're both available"?**

- *Listen for:* Passive vs. proactive preference; whether reminders feel helpful or annoying
- *Follow-up:* How often would you want those suggestions—weekly, monthly, only when you haven't seen someone in a while?

---

**Q11: Let's say your friend isn't on the app yet. Would you be willing to send them a text like "Sarah wants coffee Saturday 2pm—reply YES or NO" through the app so they can respond without downloading anything?**

- *Listen for:* SMS bridge acceptance; whether that lowers barrier
- *Follow-up:* Would you do that, or does it feel like spam?

---

### Section 4: Feature Prioritization (2 minutes)

**Goal:** Identify which features matter most

---

**Q12: I'm going to read a few features and I want you to tell me which one would make you most excited to try this app:**

| Option | Feature |
|---|---|
| A | It automatically syncs your Google Calendar so friends see when you're free (but never what you're doing) |
| B | It uses AI to learn your preferences over time (like "I prefer coffee mornings, dinner on weekends") and gets smarter |
| C | A "Social Battery" toggle so friends know when you're up for plans vs. need downtime |
| D | It tracks how often you see each friend and suggests check-ins when it's been a while |
| E | Auto-blocking travel buffer days so you're not bombarded with plans after a trip |

- *Listen for:* Ranking and reasoning; what's a "must-have" vs. "nice-to-have"

---

### Section 5: Willingness to Pay & Closing (1 minute)

---

**Q13: If this app existed and worked well, would you pay for it? If so, how much per month feels reasonable?**

- *Listen for:* Price sensitivity; free tier expectations
- *Follow-up:* What features would be worth paying for vs. expecting for free?

---

**Q14: Last question—is there anything I didn't ask about that you think would be important for an app like this?**

- *Listen for:* Blind spots, unexpected use cases, concerns

---

### Wrap-Up

> "This was super helpful, thank you! If I build this, would you be interested in trying an early version and giving feedback?"

- If yes, collect email for beta list

---

## Post-Interview Debrief (For Your Notes)

### Rate the interview:

| Dimension | Score (1–10) | Notes |
|---|---|---|
| **Problem severity** — How much does this person struggle with scheduling? | | |
| **Solution fit** — How excited were they about the proposed app? | | |
| **Network potential** — Would they invite friends and champion the app? | | |

### Key takeaways:

- What did you learn that surprised you?
- What concerns or objections came up?
- What features did they prioritize?
- Would this person be a good beta tester?

---

## Sample Size & Analysis

### Target: 10–15 interviews across diverse groups:

| Segment | Count |
|---|---|
| Busy young professionals (primary persona) | 4–5 |
| Active lifestyle folks (climbing/outdoor community) | 3–4 |
| Remote workers (different scheduling dynamics) | 2–3 |
| Recent grads / early-career (25–28) | 2–3 |

### After 10 interviews, look for patterns:

| Signal | Threshold |
|---|---|
| **Problem validation** | Do 70%+ of people express frustration with current scheduling? |
| **Calendar comfort** | Would 60%+ grant read-only Google Calendar access? |
| **Social Battery resonance** | Do 50%+ find the Social Battery concept intuitive and useful? |
| **Network willingness** | Would 50%+ invite 3+ friends to join? |
| **Feature consensus** | Is there a clear top 2–3 "must-have" features? |

### Decision criteria:

| Outcome | Criteria |
|---|---|
| ✅ **Build it** | Strong problem validation (70%+) + calendar willingness (60%+) + network potential (50%+) |
| ⚠️ **Iterate concept** | Mixed signals → refine privacy messaging or rethink approach |
| ❌ **Pivot** | Low problem severity (<50%) or privacy resistance too high |

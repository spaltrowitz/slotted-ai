import { useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';

const ACTIVITY_OPTIONS = [
  { value: 'coffee', emoji: '☕', label: 'Coffee' },
  { value: 'meal', emoji: '🍽️', label: 'Meal' },
  { value: 'drinks', emoji: '🍻', label: 'Drinks' },
  { value: 'walk', emoji: '🚶', label: 'Walk' },
  { value: 'workout', emoji: '💪', label: 'Workout' },
  { value: 'movie', emoji: '🎬', label: 'Movie' },
  { value: 'game_night', emoji: '🎮', label: 'Game Night' },
  { value: 'hangout', emoji: '😎', label: 'Hangout' },
  { value: 'other', emoji: '✨', label: 'Other' },
];

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3+ hours' },
];

const TIME_OPTIONS = [
  { value: 'morning', emoji: '🌅', label: 'Morning' },
  { value: 'afternoon', emoji: '☀️', label: 'Afternoon' },
  { value: 'evening', emoji: '🌆', label: 'Evening' },
  { value: 'night', emoji: '🌙', label: 'Night' },
];

export default function DashboardPage() {
  const { user, calendarJustConnected } = useAuth();

  // Log hangout form state
  const [showLogForm, setShowLogForm] = useState(false);
  const [logActivity, setLogActivity] = useState('hangout');
  const [logDuration, setLogDuration] = useState(60);
  const [logTimeOfDay, setLogTimeOfDay] = useState('afternoon');
  const [logSpontaneous, setLogSpontaneous] = useState(false);
  const [logRating, setLogRating] = useState(0);
  const [logSaving, setLogSaving] = useState(false);
  const [logSaved, setLogSaved] = useState(false);

  const today = new Date();
  const greeting =
    today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const timeEmoji =
    today.getHours() < 12 ? '☀️' : today.getHours() < 18 ? '🌤️' : '🌙';

  return (
    <AppShell>
      {/* Header row with greeting */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">
          {greeting}, {user?.displayName?.split(' ')[0]} {timeEmoji}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Calendar just connected toast */}
      {calendarJustConnected && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 animate-in fade-in">
          <span className="text-lg">✅</span>
          <p className="text-sm font-medium text-emerald-700">Calendar connected! Slotted will now use your availability.</p>
        </div>
      )}

      {/* Bento grid layout — asymmetric, modern */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Hero card — spans 2 columns on desktop: This Week */}
        <div className="md:col-span-2 md:row-span-2 rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="font-display text-sm font-semibold text-gray-900">This Week</h2>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-400">0 events</span>
          </div>
          <div className="flex flex-col items-center justify-center px-6 py-14">
            <div className="animate-float text-5xl">🗓️</div>
            <h3 className="mt-4 font-display text-lg font-bold text-gray-900">
              Your week is wide open
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
              Once you and your friends are connected, Slotted will show upcoming hangouts here and suggest the best times to meet.
            </p>
            <Link
              to="/friends"
              className="mt-6 inline-flex items-center gap-2 rounded-xl gradient-btn px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              Add friends to get started 👋
            </Link>
          </div>
        </div>

        {/* Right column — stacked stat cards */}
        <div className="rounded-2xl border border-gray-200/60 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-2xl">👯</span>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Friends</p>
          </div>
          <p className="mt-4 text-4xl font-bold text-gray-900">0</p>
          <p className="mt-1 text-xs text-gray-400">Invite friends to get started</p>
        </div>

        <div className="rounded-2xl border border-gray-200/60 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-2xl">✨</span>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Suggestions</p>
          </div>
          <p className="mt-4 text-4xl font-bold text-gray-900">0</p>
          <p className="mt-1 text-xs text-gray-400">AI will suggest times here</p>
        </div>

        {/* What is Slotted — explainer for new users */}
        <div className="md:col-span-3 rounded-2xl border border-teal-100 bg-gradient-to-r from-teal-50/60 via-cyan-50/40 to-blue-50/30 p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="mt-0.5 text-2xl">💡</span>
            <div className="flex-1">
              <h2 className="font-display text-base font-bold text-gray-900">What is Slotted?</h2>
              <p className="mt-1 text-sm leading-relaxed text-gray-500">
                Slotted is a social scheduling app that takes the back-and-forth out of making plans.
                It syncs with your Google Calendar, compares free times with your friends, and uses AI
                to suggest the perfect time to hang out. Both people confirm, and it goes straight on the calendar.
              </p>

            </div>
          </div>
        </div>

        {/* Log a Hangout — Progressive Profiling */}
        <div className="md:col-span-3 rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">📝</span>
              <h2 className="font-display text-sm font-semibold text-gray-900">Log a Hangout</h2>
            </div>
            {!showLogForm && (
              <button
                onClick={() => setShowLogForm(true)}
                className="rounded-xl gradient-btn px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                Log hangout
              </button>
            )}
          </div>
          {!showLogForm ? (
            <p className="mt-2 text-xs text-gray-400">
              After you hang out with a friend, log it here so Slotted can learn your preferences and suggest better times
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {/* Activity type */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">What did you do?</label>
                <div className="flex flex-wrap gap-1.5">
                  {ACTIVITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setLogActivity(opt.value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                        logActivity === opt.value
                          ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.emoji} {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">How long?</label>
                <div className="flex gap-1.5">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setLogDuration(opt.value)}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${
                        logDuration === opt.value
                          ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time of day */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">What time?</label>
                <div className="flex gap-1.5">
                  {TIME_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setLogTimeOfDay(opt.value)}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${
                        logTimeOfDay === opt.value
                          ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.emoji} {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Spontaneous + Rating row */}
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setLogSpontaneous(!logSpontaneous)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                    logSpontaneous
                      ? 'border-amber-300 bg-amber-50 text-amber-700'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  ⚡ Spontaneous?
                </button>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400 mr-1">Vibe:</span>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setLogRating(star === logRating ? 0 : star)}
                      className={`text-lg transition-all hover:scale-110 ${star <= logRating ? 'opacity-100' : 'opacity-30'}`}
                    >
                      ⭐
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  disabled={logSaving}
                  onClick={async () => {
                    setLogSaving(true);
                    try {
                      const token = await user?.getIdToken();
                      await fetch('/api/meetup-logs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({
                          activity_type: logActivity,
                          duration_min: logDuration,
                          day_of_week: new Date().getDay(),
                          time_of_day: logTimeOfDay,
                          was_spontaneous: logSpontaneous,
                          rating: logRating || null,
                        }),
                      });
                      setLogSaved(true);
                      setTimeout(() => { setLogSaved(false); setShowLogForm(false); }, 2000);
                    } catch {
                      // silent
                    } finally {
                      setLogSaving(false);
                    }
                  }}
                  className={`rounded-xl px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
                    logSaved ? 'bg-emerald-500' : 'gradient-btn'
                  }`}
                >
                  {logSaving ? 'Saving...' : logSaved ? 'Logged! ✓' : 'Save Hangout'}
                </button>
                <button
                  onClick={() => setShowLogForm(false)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* How it works — quick visual flow */}
        <div className="md:col-span-3 rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
          <h2 className="font-display text-sm font-semibold text-gray-900 mb-5">How Slotted Works</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { step: '1', emoji: '📅', title: 'Sync', desc: 'Connect your Google Calendar so we know when you\'re free' },
              { step: '2', emoji: '👋', title: 'Invite', desc: 'Send friends a link — they sign up and sync their calendar too' },
              { step: '3', emoji: '🤖', title: 'Match', desc: 'AI compares everyone\'s availability to find the best times' },
              { step: '4', emoji: '🎉', title: 'Hang', desc: 'Both of you accept, it hits both calendars, done!' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-xl">
                  {item.emoji}
                </div>
                <p className="mt-2 text-xs font-semibold text-gray-900">{item.title}</p>
                <p className="mt-1 text-xs leading-snug text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

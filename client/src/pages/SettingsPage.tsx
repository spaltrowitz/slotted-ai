import { useState, useRef, useEffect } from 'react';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';

export default function SettingsPage() {
  const { user, onboardingComplete, calendarConnected, completeOnboarding, connectCalendar, disconnectCalendar, signInWithGoogle, signOut } = useAuth();
  const [travelBuffer, setTravelBuffer] = useState('30');
  const [tripBuffer, setTripBuffer] = useState('both');
  const [personalTimeMode, setPersonalTimeMode] = useState('manual');
  const [socialFrequency, setSocialFrequency] = useState('weekly');
  const [preferredTimes, setPreferredTimes] = useState<string[]>(['weekday-evening', 'weekend-afternoon']);
  const [weeklyDefaults, setWeeklyDefaults] = useState<Record<string, string>>({
    Mon: 'ask_me', Tue: 'ask_me', Wed: 'ask_me', Thu: 'ask_me',
    Fri: 'open', Sat: 'open', Sun: 'open',
  });
  const [saved, setSaved] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [showAppleHelp, setShowAppleHelp] = useState(false);
  const [showManualAvail, setShowManualAvail] = useState(false);
  const [neighborhood, setNeighborhood] = useState('');
  const [manualAvailability, setManualAvailability] = useState<Record<string, string[]>>({
    Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [],
  });
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  // Learned preferences from progressive profiling
  const [learnedPrefs, setLearnedPrefs] = useState<{
    preferred_activity?: string;
    avg_duration_min?: number;
    preferred_time?: string;
    preferred_day?: string;
    planning_style?: string;
    total_meetups_logged: number;
  }>({ total_meetups_logged: 0 });

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/preferences/learned', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setLearnedPrefs(data);
        }
      } catch {
        // silently fail
      }
    })();
  }, [user]);

  const handleSave = () => {
    // TODO: save settings to API
    console.log('Settings saved:', { travelBuffer, tripBuffer, personalTimeMode, socialFrequency, preferredTimes });
    if (!onboardingComplete) {
      completeOnboarding();
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleTime = (value: string) => {
    setPreferredTimes((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]
    );
  };

  const googleIcon = (
    <svg className="h-5 w-5" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );

  return (
    <AppShell>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">Your account and preferences</p>
        </div>
        <button
          onClick={handleSave}
          className={`rounded-xl px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
            saved ? 'bg-emerald-500' : 'gradient-btn'
          }`}
        >
          {saved ? 'Saved! \u2713' : 'Save Changes'}
        </button>
      </div>

      {/* 2-column layout */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5">
          {/* Profile */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Profile</h2>
            <div className="mt-4 flex items-center gap-4">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="h-14 w-14 rounded-full ring-2 ring-slotted-100" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-lg font-bold text-white">
                  {user?.displayName?.[0] ?? '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{user?.displayName}</p>
                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">
                Home neighborhood
              </label>
              <p className="mt-0.5 text-[11px] text-gray-400">Helps suggest meetups near you (e.g. weekday lunches if a friend is nearby)</p>
              <input
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                placeholder="e.g. West Village, NYC"
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={async () => { await signOut(); signInWithGoogle(); }}
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-all hover:border-gray-300 hover:bg-gray-50"
              >
                Switch account
              </button>
              <button
                onClick={signOut}
                className="flex-1 rounded-xl border border-red-100 bg-red-50/50 px-3 py-2 text-xs font-medium text-red-600 transition-all hover:bg-red-50 hover:border-red-200"
              >
                Sign out
              </button>
            </div>

            {/* Calendar section */}
            <div className="mt-5 border-t border-gray-100 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Calendar</h3>
              {calendarConnected ? (
              <>
                <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm">
                      {googleIcon}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Google Calendar</p>
                      <p className="text-xs text-gray-400">{user?.email}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Connected
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={async () => { disconnectCalendar(); await signOut(); signInWithGoogle(); }}
                    className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-all hover:border-gray-300 hover:bg-gray-50"
                  >
                    Connect different calendar
                  </button>
                  <button
                    onClick={disconnectCalendar}
                    className="flex-1 rounded-xl border border-red-100 bg-red-50/50 px-3 py-2 text-xs font-medium text-red-600 transition-all hover:bg-red-50 hover:border-red-200"
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-100 bg-gradient-to-r from-amber-50/50 to-orange-50/50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm">
                      {googleIcon}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Google Calendar</p>
                      <p className="text-xs text-gray-400">Not connected yet</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    Not connected
                  </span>
                </div>
                <button
                  onClick={connectCalendar}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl gradient-btn px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                >
                  Connect Google Calendar
                </button>
                <p className="mt-2 text-[11px] text-gray-400">
                  We only read busy/free times — never event names or details
                </p>
              </>
            )}

            {/* Apple Calendar help */}
            <div className="mt-4 border-t border-gray-100 pt-4">
              <button
                onClick={() => setShowAppleHelp(!showAppleHelp)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="text-xs font-medium text-gray-600">🍎 Using Apple Calendar?</span>
                <svg className={`h-4 w-4 text-gray-400 transition-transform ${showAppleHelp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showAppleHelp && (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-xs text-gray-600 space-y-2">
                  <p className="font-medium text-gray-800">Sync Apple Calendar → Google Calendar in 3 steps:</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-gray-500">
                    <li>On your iPhone/Mac, open <strong>Settings → Calendar → Accounts</strong> and add your Google account</li>
                    <li>Toggle on <strong>Calendars</strong> to sync — your Apple Calendar events will appear in Google Calendar automatically</li>
                    <li>Come back here and connect Google Calendar — Slotted will see all your synced events</li>
                  </ol>
                  <p className="text-gray-400 pt-1">
                    💡 Alternatively, export your Apple Calendar as an .ics file and import it into Google Calendar at{' '}
                    <a href="https://calendar.google.com/calendar/r/settings/export" target="_blank" rel="noopener noreferrer" className="text-slotted-600 underline">
                      calendar.google.com
                    </a>
                  </p>
                </div>
              )}
            </div>

            {/* Manual availability option */}
            <div className="mt-3 border-t border-gray-100 pt-4">
              <button
                onClick={() => setShowManualAvail(!showManualAvail)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="text-xs font-medium text-gray-600">✏️ Enter availability manually</span>
                <svg className={`h-4 w-4 text-gray-400 transition-transform ${showManualAvail ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showManualAvail && (
                <div className="mt-3 space-y-3">
                  <p className="text-[11px] text-gray-400">Don't use Google Calendar? No problem — mark your typical available times below.</p>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                    <div key={day} className="flex items-center gap-3">
                      <span className="w-10 text-xs font-semibold text-gray-700">{day}</span>
                      <div className="flex flex-1 gap-1.5">
                        {[
                          { value: 'morning', label: 'AM', emoji: '🌅' },
                          { value: 'afternoon', label: 'PM', emoji: '☀️' },
                          { value: 'evening', label: 'Eve', emoji: '🌙' },
                        ].map((slot) => {
                          const isSelected = manualAvailability[day]?.includes(slot.value);
                          return (
                            <button
                              key={slot.value}
                              onClick={() => {
                                setManualAvailability((prev) => ({
                                  ...prev,
                                  [day]: isSelected
                                    ? prev[day].filter((s) => s !== slot.value)
                                    : [...(prev[day] || []), slot.value],
                                }));
                              }}
                              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${
                                isSelected
                                  ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                              }`}
                            >
                              <span className="mr-1">{slot.emoji}</span>{slot.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-gray-400">
                    Select all time blocks when you're typically free. This replaces calendar sync for availability detection.
                  </p>
                </div>
              )}
            </div>
            </div>
          </div>

          {/* Scheduling preferences */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Scheduling</h2>
            <div className="mt-4 space-y-5">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">
                  Social frequency
                </label>
                <select
                  value={socialFrequency}
                  onChange={(e) => setSocialFrequency(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
                >
                  <option value="daily">Almost every day</option>
                  <option value="2-3-week">2–3 times per week</option>
                  <option value="weekly">About once a week</option>
                  <option value="2-3-month">2–3 times per month</option>
                  <option value="rarely">Less often</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">
                  Meetup buffer
                </label>
                <p className="mt-0.5 text-[11px] text-gray-400">Padding before/after each meetup so you're never rushing</p>
                <select
                  value={travelBuffer}
                  onChange={(e) => setTravelBuffer(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
                >
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">1 hour</option>
                </select>
              </div>
            </div>
          </div>

          {/* Weekly Defaults — Social Battery */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Weekly Defaults</h2>
            <p className="mt-1 text-xs text-gray-400">Set your social energy for each day — Slotted will respect these when suggesting times</p>
            <div className="mt-4 space-y-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="flex items-center gap-3">
                  <span className="w-10 text-xs font-semibold text-gray-700">{day}</span>
                  <div className="flex flex-1 gap-1.5">
                    {[
                      { value: 'open', emoji: '🟢', label: 'Open' },
                      { value: 'ask_me', emoji: '🟡', label: 'Ask Me' },
                      { value: 'recharging', emoji: '🔴', label: 'Recharging' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setWeeklyDefaults((prev) => ({ ...prev, [day]: opt.value }))}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${
                          weeklyDefaults[day] === opt.value
                            ? opt.value === 'open'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm'
                              : opt.value === 'ask_me'
                                ? 'border-amber-300 bg-amber-50 text-amber-700 shadow-sm'
                                : 'border-red-300 bg-red-50 text-red-700 shadow-sm'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        <span className="mr-1">{opt.emoji}</span>{opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-gray-400">
              🟢 Open = suggest freely &nbsp;·&nbsp; 🟡 Ask Me = only if there's a great match &nbsp;·&nbsp; 🔴 Recharging = don't suggest
            </p>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Protect personal time */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Protect Personal Time</h2>
            <p className="mt-1 text-xs text-gray-400">How do you want to handle times you're technically free but don't want plans?</p>
            <div className="mt-4 space-y-2">
              {[
                { value: 'manual', label: '\uD83D\uDD27 I\'ll manually mark blocks as unavailable', desc: 'Full control \u2014 mark specific times as off-limits yourself' },
                { value: 'recurring', label: '\uD83D\uDD01 Help me set up recurring protected time', desc: 'Automatically block gym, family time, personal time, etc.' },
                { value: 'open', label: '\uD83D\uDCD6 Show all my free time', desc: 'I\'m comfortable letting friends see all open slots' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPersonalTimeMode(opt.value)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                    personalTimeMode === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 shadow-sm'
                      : 'border-gray-200 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  <p className={`text-sm font-medium ${personalTimeMode === opt.value ? 'text-slotted-700' : 'text-gray-900'}`}>{opt.label}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Trip buffers */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Trip Buffers</h2>
            <p className="mt-1 text-xs text-gray-400">When we detect travel on your calendar, should we auto-block recovery time?</p>
            <div className="mt-4 space-y-2">
              {[
                { value: 'before', label: 'Block the day before travel', desc: 'Packing and prep time' },
                { value: 'after', label: 'Block the day after travel', desc: 'Recovery and jet lag' },
                { value: 'both', label: 'Block both before and after', desc: 'Full buffer around trips' },
                { value: 'none', label: 'No buffers needed', desc: 'I\'m always available around travel' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTripBuffer(opt.value)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                    tripBuffer === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 shadow-sm'
                      : 'border-gray-200 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  <p className={`text-sm font-medium ${tripBuffer === opt.value ? 'text-slotted-700' : 'text-gray-900'}`}>{opt.label}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Preferred times */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Preferred Hangout Times</h2>
            <p className="mt-1 text-xs text-gray-400">Select all that apply</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                { value: 'weekday-morning', emoji: '🌅', prefix: 'Weekday', suffix: 'mornings' },
                { value: 'weekday-lunch', emoji: '☀️', prefix: 'Weekday', suffix: 'lunches' },
                { value: 'weekday-evening', emoji: '🌆', prefix: 'Weekday', suffix: 'evenings' },
                { value: 'weekend-morning', emoji: '🥐', prefix: 'Weekend', suffix: 'mornings' },
                { value: 'weekend-afternoon', emoji: '🏖️', prefix: 'Weekend', suffix: 'afternoons' },
                { value: 'weekend-evening', emoji: '🌙', prefix: 'Weekend', suffix: 'evenings' },
              ].map((opt) => {
                const selected = preferredTimes.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleTime(opt.value)}
                    className={`rounded-xl border px-3 py-2.5 text-left text-xs transition-all ${
                      selected
                        ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                        : 'border-gray-200 text-gray-600 hover:border-slotted-200 hover:bg-gray-50'
                    }`}
                  >
                    {opt.emoji} <span className="font-bold">{opt.prefix}</span> {opt.suffix}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Learned Preferences — Progressive Profiling */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-lg">🧠</span>
              <h2 className="text-sm font-semibold text-gray-900">Learned Preferences</h2>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Slotted learns your habits as you log hangouts — these patterns improve your suggestions over time
            </p>

            {learnedPrefs.total_meetups_logged >= 3 ? (
              <div className="mt-4 space-y-3">
                {learnedPrefs.preferred_activity && (
                  <div className="flex items-center gap-3 rounded-xl border border-violet-100 bg-gradient-to-r from-violet-50/50 to-fuchsia-50/50 px-4 py-3">
                    <span className="text-lg">
                      {({ coffee: '☕', meal: '🍽️', drinks: '🍻', walk: '🚶', workout: '💪', movie: '🎬', game_night: '🎮', hangout: '😎', other: '✨' } as Record<string, string>)[learnedPrefs.preferred_activity] || '✨'}
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-gray-800">Favorite activity</p>
                      <p className="text-xs text-gray-500 capitalize">{learnedPrefs.preferred_activity.replace('_', ' ')}</p>
                    </div>
                  </div>
                )}
                {learnedPrefs.avg_duration_min && (
                  <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50/50 to-cyan-50/50 px-4 py-3">
                    <span className="text-lg">⏱️</span>
                    <div>
                      <p className="text-xs font-semibold text-gray-800">Average duration</p>
                      <p className="text-xs text-gray-500">
                        {learnedPrefs.avg_duration_min >= 60
                          ? `${Math.floor(learnedPrefs.avg_duration_min / 60)}h ${learnedPrefs.avg_duration_min % 60 > 0 ? `${learnedPrefs.avg_duration_min % 60}m` : ''}`
                          : `${learnedPrefs.avg_duration_min} min`}
                      </p>
                    </div>
                  </div>
                )}
                {learnedPrefs.preferred_time && (
                  <div className="flex items-center gap-3 rounded-xl border border-amber-100 bg-gradient-to-r from-amber-50/50 to-orange-50/50 px-4 py-3">
                    <span className="text-lg">
                      {({ morning: '🌅', afternoon: '☀️', evening: '🌆', night: '🌙' } as Record<string, string>)[learnedPrefs.preferred_time] || '🕐'}
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-gray-800">Preferred time</p>
                      <p className="text-xs text-gray-500 capitalize">{learnedPrefs.preferred_time} {learnedPrefs.preferred_day ? `· ${learnedPrefs.preferred_day}s` : ''}</p>
                    </div>
                  </div>
                )}
                {learnedPrefs.planning_style && (
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 px-4 py-3">
                    <span className="text-lg">{learnedPrefs.planning_style === 'spontaneous' ? '⚡' : learnedPrefs.planning_style === 'planner' ? '📋' : '🔄'}</span>
                    <div>
                      <p className="text-xs font-semibold text-gray-800">Planning style</p>
                      <p className="text-xs text-gray-500 capitalize">{learnedPrefs.planning_style}</p>
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 text-center pt-1">
                  Based on {learnedPrefs.total_meetups_logged} logged hangouts
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-6 text-center">
                <span className="text-2xl">📊</span>
                <p className="mt-2 text-xs font-medium text-gray-600">
                  {learnedPrefs.total_meetups_logged === 0
                    ? 'No hangouts logged yet'
                    : `${learnedPrefs.total_meetups_logged} of 3 hangouts logged`}
                </p>
                <p className="mt-1 text-[11px] text-gray-400">
                  Log at least 3 hangouts from the Dashboard and Slotted will start learning your patterns
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feedback */}
      <div className="mt-5 rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-50 to-fuchsia-50 text-lg">
            💬
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Share Feedback</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Found a bug? Have an idea? Let me know — every message goes straight to the developer.
            </p>
          </div>
        </div>
        <textarea
          ref={feedbackRef}
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          placeholder="What's on your mind?"
          rows={3}
          className="mt-4 w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-all focus:border-slotted-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slotted-100"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-gray-400">
            Sent from {user?.email}
          </p>
          <button
            disabled={!feedbackText.trim() || feedbackSending}
            onClick={async () => {
              setFeedbackSending(true);
              try {
                const token = await user?.getIdToken();
                await fetch('/api/feedback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ message: feedbackText.trim() }),
                });
                setFeedbackSent(true);
                setFeedbackText('');
                setTimeout(() => setFeedbackSent(false), 3000);
              } catch {
                // silently fail for now
              } finally {
                setFeedbackSending(false);
              }
            }}
            className={`rounded-xl px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-sm ${
              feedbackSent ? 'bg-emerald-500' : 'gradient-btn'
            }`}
          >
            {feedbackSending ? 'Sending\u2026' : feedbackSent ? 'Sent! Thank you \u2713' : 'Send Feedback'}
          </button>
        </div>
      </div>
    </AppShell>
  );
}

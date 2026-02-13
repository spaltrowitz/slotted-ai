import { useState, useRef, useEffect } from 'react';
import AppShell from '../components/AppShell';
import CalendarPicker from '../components/CalendarPicker';
import { useAuth } from '../contexts/AuthContext';

export default function SettingsPage() {
  const { user, onboardingComplete, googleCalendarConnected, completeOnboarding, connectCalendar, disconnectCalendar, appleCalendarConnected, connectAppleCalendar, disconnectAppleCalendar, signInWithGoogle, signOut } = useAuth();
  const [travelBuffer, setTravelBuffer] = useState(30);
  const [tripBufferBefore, setTripBufferBefore] = useState(false);
  const [tripBufferAfter, setTripBufferAfter] = useState(true);
  const [personalTimeProtection, setPersonalTimeProtection] = useState(50);
  const [planningStyle, setPlanningStyle] = useState('flexible');
  const [preferredTimes, setPreferredTimes] = useState<string[]>(['weekday-evening', 'weekend-afternoon']);
  const [saved, setSaved] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackSending, setFeedbackSending] = useState(false);

  const [showAppleConnect, setShowAppleConnect] = useState(false);
  const [appleEmail, setAppleEmail] = useState(user?.email || '');
  const [applePassword, setApplePassword] = useState('');
  const [appleConnecting, setAppleConnecting] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);
  const [appleSuccess, setAppleSuccess] = useState(false);
  const [showAppleCalendarDetails, setShowAppleCalendarDetails] = useState(false);
  const [showAppleWhy, setShowAppleWhy] = useState(false);
  const [showManualAvail, setShowManualAvail] = useState(false);
  const [showCalendarDetails, setShowCalendarDetails] = useState(false);

  const [socialRecharge, setSocialRecharge] = useState('2-3-week');
  const [rechargingDays, setRechargingDays] = useState<number[]>([]);
  const [neighborhood, setNeighborhood] = useState('');
  const [workNeighborhood, setWorkNeighborhood] = useState('');
  const [officeDays, setOfficeDays] = useState<string[]>([]);
  const [officeVaries, setOfficeVaries] = useState(false);
  const [manualAvailability, setManualAvailability] = useState<Record<string, string[]>>({
    Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [],
  });
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  // Call windows for phone/video availability
  const [callWindows, setCallWindows] = useState<{ day: number; start: string; end: string; label: string }[]>([]);

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
        // Load learned preferences
        const prefsRes = await fetch('/api/preferences/learned', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (prefsRes.ok) {
          const data = await prefsRes.json();
          setLearnedPrefs(data);
        }
        // Load user settings
        const meRes = await fetch('/api/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.social_frequency) setSocialRecharge(me.social_frequency);
          if (me.preferred_times) setPreferredTimes(me.preferred_times);
          if (me.travel_buffer_min) setTravelBuffer(me.travel_buffer_min);
          if (me.trip_buffer_before !== undefined) setTripBufferBefore(me.trip_buffer_before);
          if (me.trip_buffer_after !== undefined) setTripBufferAfter(me.trip_buffer_after);
          if (me.recharging_days) setRechargingDays(me.recharging_days);
          if (me.call_windows && Array.isArray(me.call_windows)) setCallWindows(me.call_windows);
          if (me.neighborhood) setNeighborhood(me.neighborhood);
        }
      } catch {
        // silently fail
      }
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      await fetch('/api/users/me/settings', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          socialFrequency: socialRecharge,
          preferredTimes,
          travelBuffer,
          tripBufferBefore,
          tripBufferAfter,
          rechargingDays,
          planningStyle,
          neighborhood,
          workNeighborhood,
          officeDays,
          callWindows,
        }),
      });
    } catch {
      // silent
    }
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

  const toggleOfficeDay = (day: string) => {
    setOfficeDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
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


  const personalTimeLabel = personalTimeProtection <= 20 ? 'Show all free time' : personalTimeProtection <= 50 ? 'Light protection' : personalTimeProtection <= 80 ? 'Moderate protection' : 'Maximum protection';

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
          {saved ? 'Saved! ✓' : 'Save Changes'}
        </button>
      </div>

      {/* 2-column layout */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5">

          {/* ─── Compact Profile & Calendar ─── */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
            {/* Profile row */}
            <div className="flex items-center gap-3">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="h-10 w-10 rounded-full ring-2 ring-slotted-100" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-sm font-bold text-white">
                  {user?.displayName?.[0] ?? '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{user?.displayName}</p>
                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
              </div>
            </div>

            {/* Calendar status — compact inline */}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white border border-gray-100 shadow-sm">
                    {googleIcon}
                  </div>
                  <span className="text-xs font-medium text-gray-700">Google Calendar</span>
                  {googleCalendarConnected ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      Not connected
                    </span>
                  )}
                </div>
                {googleCalendarConnected ? (
                  <button
                    onClick={() => setShowCalendarDetails(!showCalendarDetails)}
                    className="text-[11px] font-medium text-slotted-600 hover:text-slotted-700"
                  >
                    {showCalendarDetails ? 'Hide' : 'Manage'}
                  </button>
                ) : (
                  <button
                    onClick={connectCalendar}
                    className="rounded-lg gradient-btn px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-all hover:shadow-md"
                  >
                    Connect
                  </button>
                )}
              </div>

              {/* Expandable calendar details */}
              {showCalendarDetails && googleCalendarConnected && (
                <div className="mt-3 space-y-2 rounded-xl border border-gray-100 bg-gray-50/30 p-3">
                  <CalendarPicker source="google" />
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={async () => { disconnectCalendar(); await signOut(); signInWithGoogle(); }}
                      className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50"
                    >
                      Switch calendar
                    </button>
                    <button
                      onClick={disconnectCalendar}
                      className="flex-1 rounded-lg border border-red-100 bg-red-50/50 px-2 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              )}

              {!googleCalendarConnected && (
                <p className="mt-1.5 text-[11px] text-gray-400">
                  We only read busy/free times — never event names or details
                </p>
              )}

              {/* Apple Calendar — compact */}
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white border border-gray-100 shadow-sm text-sm">
                    🍎
                  </div>
                  <span className="text-xs font-medium text-gray-700">Apple Calendar</span>
                  {appleCalendarConnected ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                      Not connected
                    </span>
                  )}
                </div>
                {appleCalendarConnected ? (
                  <button
                    onClick={() => setShowAppleCalendarDetails(!showAppleCalendarDetails)}
                    className="text-[11px] font-medium text-slotted-600 hover:text-slotted-700"
                  >
                    {showAppleCalendarDetails ? 'Hide' : 'Manage'}
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAppleConnect(!showAppleConnect)}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-all hover:bg-gray-800"
                  >
                    Connect
                  </button>
                )}
              </div>

              {/* Expandable Apple calendar details */}
              {showAppleCalendarDetails && appleCalendarConnected && (
                <div className="mt-2 space-y-2 rounded-xl border border-gray-100 bg-gray-50/30 p-3">
                  <CalendarPicker source="apple" />
                  <div className="pt-1">
                    <button
                      onClick={disconnectAppleCalendar}
                      className="w-full rounded-lg border border-red-100 bg-red-50/50 px-2 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50"
                    >
                      Disconnect Apple Calendar
                    </button>
                  </div>
                </div>
              )}

              {/* Apple connect form — improved UX */}
              {showAppleConnect && !appleCalendarConnected && (
                <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/50 p-3 space-y-2">
                  <p className="text-[11px] text-gray-600">
                    Enter your Apple ID and an <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium">app-specific password</a> to connect.
                  </p>
                  <button
                    onClick={() => setShowAppleWhy(!showAppleWhy)}
                    className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className={`h-3 w-3 transition-transform ${showAppleWhy ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Why do I need this?
                  </button>
                  {showAppleWhy && (
                    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-2 text-[10px] text-gray-500 space-y-1">
                      <p>Apple doesn't offer a calendar API like Google does, so all third-party apps (Calendly, Reclaim, etc.) use the same approach:</p>
                      <ol className="list-decimal list-inside space-y-0.5">
                        <li>Go to <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">appleid.apple.com</a> → Sign-In and Security</li>
                        <li>Generate an App-Specific Password (name it "Slotted")</li>
                        <li>Paste it below — we only read busy/free times, never event details</li>
                      </ol>
                      <p className="text-gray-400">You can revoke this anytime from your Apple ID settings.</p>
                    </div>
                  )}
                  <input
                    type="email"
                    value={appleEmail}
                    onChange={(e) => { setAppleEmail(e.target.value); setAppleError(null); }}
                    placeholder="Apple ID email (e.g. you@icloud.com)"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-slotted-400 focus:outline-none focus:ring-1 focus:ring-slotted-100"
                  />
                  <p className="text-[10px] text-gray-400">Not sure? Check Settings → Apple ID on your iPhone, or go to appleid.apple.com</p>
                  <input
                    type="password"
                    value={applePassword}
                    onChange={(e) => { setApplePassword(e.target.value); setAppleError(null); }}
                    placeholder="App-specific password"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-slotted-400 focus:outline-none focus:ring-1 focus:ring-slotted-100"
                  />
                  {appleError && (
                    <p className="text-[11px] text-red-600">{appleError}</p>
                  )}
                  {appleSuccess && (
                    <p className="text-[11px] text-emerald-700">✓ Connected!</p>
                  )}
                  <button
                    onClick={async () => {
                      if (!appleEmail || !applePassword) {
                        setAppleError('Please enter both email and app-specific password.');
                        return;
                      }
                      setAppleConnecting(true);
                      setAppleError(null);
                      setAppleSuccess(false);
                      const result = await connectAppleCalendar(appleEmail, applePassword);
                      setAppleConnecting(false);
                      if (result.success) {
                        setAppleSuccess(true);
                        setAppleEmail('');
                        setApplePassword('');
                        setShowAppleConnect(false);
                      } else {
                        setAppleError(result.error || 'Connection failed.');
                      }
                    }}
                    disabled={appleConnecting || !appleEmail || !applePassword}
                    className="w-full rounded-lg bg-gray-900 px-3 py-2 text-[11px] font-semibold text-white transition-all hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {appleConnecting ? 'Connecting…' : 'Connect'}
                  </button>
                </div>
              )}

              {/* Manual availability toggle */}
              <button
                onClick={() => setShowManualAvail(!showManualAvail)}
                className="mt-2 flex w-full items-center justify-between text-left"
              >
                <span className="text-[11px] font-medium text-gray-500">✏️ Enter availability manually instead</span>
                <svg className={`h-3.5 w-3.5 text-gray-400 transition-transform ${showManualAvail ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showManualAvail && (
                <div className="mt-2 space-y-2">
                  <p className="text-[10px] text-gray-400">Mark your typical available times:</p>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                    <div key={day} className="flex items-center gap-2">
                      <span className="w-8 text-[11px] font-semibold text-gray-600">{day}</span>
                      <div className="flex flex-1 gap-1">
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
                              className={`flex-1 rounded-md border px-1.5 py-1 text-[10px] font-medium transition-all ${
                                isSelected
                                  ? 'border-slotted-400 bg-slotted-50 text-slotted-700'
                                  : 'border-gray-200 text-gray-400 hover:bg-gray-50'
                              }`}
                            >
                              {slot.emoji} {slot.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── Neighborhoods ─── */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">📍 Neighborhoods</h2>
            <p className="mt-0.5 text-[11px] text-gray-400">Helps suggest meetups near you</p>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Home */}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">Home</label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="e.g. West Village, NYC"
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-1 focus:ring-slotted-100"
                />
              </div>
              {/* Work */}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">Work</label>
                <input
                  type="text"
                  value={workNeighborhood}
                  onChange={(e) => setWorkNeighborhood(e.target.value)}
                  placeholder="e.g. Midtown, NYC"
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-1 focus:ring-slotted-100"
                />
              </div>
            </div>

            {/* Office days */}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">Office days</label>
              <p className="mt-0.5 text-[10px] text-gray-400">Which days are you typically in the office?</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex gap-1">
                  {['M', 'Tu', 'W', 'Th', 'F'].map((day) => {
                    const fullDay = ({ M: 'Mon', Tu: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri' } as Record<string, string>)[day]!;
                    const isSelected = officeDays.includes(fullDay);
                    return (
                      <button
                        key={day}
                        onClick={() => { if (!officeVaries) toggleOfficeDay(fullDay); }}
                        disabled={officeVaries}
                        className={`h-8 w-8 rounded-lg border text-[11px] font-bold transition-all ${
                          officeVaries
                            ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                            : isSelected
                              ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                              : 'border-gray-200 text-gray-500 hover:border-slotted-200 hover:bg-gray-50'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => { setOfficeVaries(!officeVaries); if (!officeVaries) setOfficeDays([]); }}
                  className={`ml-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                    officeVaries
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                      : 'border-gray-200 text-gray-500 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  Varies week to week
                </button>
              </div>
            </div>

          </div>

          {/* ─── Call Windows ─── */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-lg">📞</span>
              <h2 className="text-sm font-semibold text-gray-900">Call Windows</h2>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-400">
              Recurring times you're available for phone or video calls — great for long-distance friends
            </p>

            {callWindows.length > 0 && (
              <div className="mt-3 space-y-2">
                {callWindows.map((w, idx) => {
                  const dayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][w.day] || '?';
                  return (
                    <div key={idx} className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/30 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-gray-700">{dayLabel}</span>
                        <span className="text-[11px] text-gray-500">{w.start} – {w.end}</span>
                        {w.label && <span className="text-[10px] text-gray-400">({w.label})</span>}
                      </div>
                      <button
                        onClick={() => setCallWindows((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quick-add presets */}
            <div className="mt-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-2">Quick add</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: '🥪 Weekday lunch', days: [1,2,3,4,5], start: '12:00', end: '13:00', tag: 'Lunch break' },
                  { label: '🚗 Commute', days: [1,2,3,4,5], start: '17:30', end: '18:30', tag: 'Commute' },
                  { label: '🌆 Weekday evening', days: [1,2,3,4,5], start: '19:00', end: '21:00', tag: 'Evening' },
                  { label: '☀️ Weekend morning', days: [0,6], start: '09:00', end: '11:00', tag: 'Morning' },
                  { label: '🌙 Weekend evening', days: [0,6], start: '18:00', end: '21:00', tag: 'Evening' },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      const newWindows = preset.days.map((day) => ({
                        day,
                        start: preset.start,
                        end: preset.end,
                        label: preset.tag,
                      }));
                      // Avoid duplicates
                      setCallWindows((prev) => {
                        const existing = new Set(prev.map((w) => `${w.day}-${w.start}-${w.end}`));
                        const unique = newWindows.filter((w) => !existing.has(`${w.day}-${w.start}-${w.end}`));
                        return [...prev, ...unique];
                      });
                    }}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-medium text-gray-600 transition-all hover:border-slotted-200 hover:bg-slotted-50"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom add */}
            <details className="mt-3">
              <summary className="text-[11px] font-medium text-gray-400 hover:text-slotted-600 cursor-pointer transition-colors">
                + Add custom window
              </summary>
              <div className="mt-2 flex items-end gap-2">
                <div>
                  <label className="block text-[10px] text-gray-400 mb-0.5">Day</label>
                  <select id="cw-day" className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-slotted-400 focus:outline-none">
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
                      <option key={d} value={i}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-0.5">Start</label>
                  <input id="cw-start" type="time" defaultValue="12:00" className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-slotted-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-0.5">End</label>
                  <input id="cw-end" type="time" defaultValue="13:00" className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-slotted-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-0.5">Label</label>
                  <input id="cw-label" type="text" placeholder="e.g. Lunch" className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-slotted-400 focus:outline-none" />
                </div>
                <button
                  onClick={() => {
                    const day = parseInt((document.getElementById('cw-day') as HTMLSelectElement).value);
                    const start = (document.getElementById('cw-start') as HTMLInputElement).value;
                    const end = (document.getElementById('cw-end') as HTMLInputElement).value;
                    const label = (document.getElementById('cw-label') as HTMLInputElement).value;
                    if (start && end) {
                      setCallWindows((prev) => [...prev, { day, start, end, label }]);
                    }
                  }}
                  className="rounded-lg gradient-btn px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                >
                  Add
                </button>
              </div>
            </details>
          </div>

          {/* ─── Social Battery (recharge) ─── */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔋</span>
              <h2 className="text-sm font-semibold text-gray-900">Social Battery</h2>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              How often do you want to hang out with <span className="font-semibold text-gray-600">anyone</span> — all friends combined, not per person?
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {[
                { value: 'daily', emoji: '🥳', label: 'Every day', desc: "I'm happy to see any friend on any day — no limit" },
                { value: '2-3-week', emoji: '😊', label: '2–3 plans per week', desc: 'I like being social but need a couple days between any plans' },
                { value: 'weekly', emoji: '🧘', label: 'About 1 plan per week', desc: 'One hangout (with anyone) per week is my sweet spot' },
                { value: 'biweekly', emoji: '🏡', label: '1–2 plans per month', desc: 'I prefer lots of downtime between any social plans' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSocialRecharge(opt.value)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all ${
                    socialRecharge === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 shadow-sm'
                      : 'border-gray-200 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-lg">{opt.emoji}</span>
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold ${socialRecharge === opt.value ? 'text-slotted-700' : 'text-gray-800'}`}>{opt.label}</p>
                    <p className="text-[10px] text-gray-400">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Recharging days checkboxes */}
            <div className="mt-4">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Always-recharge days
              </label>
              <p className="mt-0.5 text-[10px] text-gray-400">Select days you never want plans with anyone — Slotted won't suggest hangouts on these days</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  { day: 0, label: 'Sun' },
                  { day: 1, label: 'Mon' },
                  { day: 2, label: 'Tue' },
                  { day: 3, label: 'Wed' },
                  { day: 4, label: 'Thu' },
                  { day: 5, label: 'Fri' },
                  { day: 6, label: 'Sat' },
                ].map(({ day, label }) => {
                  const selected = rechargingDays.includes(day);
                  return (
                    <button
                      key={day}
                      onClick={() => setRechargingDays((prev) =>
                        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                      )}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        selected
                          ? 'border-red-300 bg-red-50 text-red-700'
                          : 'border-gray-200 text-gray-500 hover:border-red-200 hover:bg-red-50/50'
                      }`}
                    >
                      {selected && <span>🔴</span>}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/50 px-3 py-2">
              <p className="text-[11px] text-gray-500">
                {rechargingDays.length > 0
                  ? `💡 Slotted will never suggest plans on ${rechargingDays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}.`
                  : socialRecharge === 'daily'
                    ? '💡 Slotted will look for every good opportunity to help you connect with friends.'
                    : socialRecharge === '2-3-week'
                      ? '💡 Slotted will suggest plans with enough breathing room between hangouts.'
                      : socialRecharge === 'weekly'
                        ? '💡 Slotted will space out suggestions and protect your downtime.'
                        : '💡 Slotted will be very selective, only suggesting the best opportunities.'}
              </p>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">

          {/* ─── Scheduling Preferences (consolidated) ─── */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Scheduling Preferences</h2>
            <p className="mt-0.5 text-[11px] text-gray-400">Controls how Slotted's AI suggests plans for you</p>

            {/* Planning style */}
            <div className="mt-4">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Planning style
              </label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { value: 'spontaneous', emoji: '⚡', label: 'Spontaneous' },
                  { value: 'flexible', emoji: '🔄', label: 'Flexible' },
                  { value: 'planner', emoji: '📋', label: 'Planner' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPlanningStyle(opt.value)}
                    className={`rounded-xl border px-3 py-2.5 text-center transition-all ${
                      planningStyle === opt.value
                        ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 shadow-sm'
                        : 'border-gray-200 text-gray-600 hover:border-slotted-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-base">{opt.emoji}</span>
                    <p className={`mt-0.5 text-[11px] font-semibold ${planningStyle === opt.value ? 'text-slotted-700' : 'text-gray-800'}`}>{opt.label}</p>
                  </button>
                ))}
              </div>
              <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
                <p className="text-[10px] text-gray-500">
                  {planningStyle === 'spontaneous'
                    ? '⚡ AI will suggest same-day and next-day plans, prioritize friends who are free right now, and send quick "are you free tonight?" nudges.'
                    : planningStyle === 'planner'
                      ? '📋 AI will suggest plans 1–4 weeks in advance, help you lock in recurring hangouts, and send gentle reminders to confirm early.'
                      : '🔄 AI adapts to each friendship — when matching with another planner, it\'ll book further out. With spontaneous friends, it\'ll surface last-minute opportunities.'}
                </p>
              </div>
            </div>

            {/* Preferred hangout times */}
            <div className="mt-4">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Preferred hangout times
              </label>
              <div className="mt-2 grid grid-cols-2 gap-4">
                {/* Weekdays column */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Weekdays</p>
                  {[
                    { value: 'weekday-morning', emoji: '🌅', label: 'Morning' },
                    { value: 'weekday-afternoon', emoji: '☀️', label: 'Afternoon' },
                    { value: 'weekday-evening', emoji: '🌆', label: 'Evening' },
                  ].map((opt) => {
                    const selected = preferredTimes.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => toggleTime(opt.value)}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-[11px] transition-all ${
                          selected
                            ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm font-semibold'
                            : 'border-gray-200 text-gray-500 hover:border-slotted-200 hover:bg-gray-50'
                        }`}
                      >
                        {opt.emoji} {opt.label}
                      </button>
                    );
                  })}
                </div>
                {/* Weekends column */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Weekends</p>
                  {[
                    { value: 'weekend-morning', emoji: '🥐', label: 'Morning' },
                    { value: 'weekend-afternoon', emoji: '☀️', label: 'Afternoon' },
                    { value: 'weekend-evening', emoji: '🌙', label: 'Evening' },
                  ].map((opt) => {
                    const selected = preferredTimes.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => toggleTime(opt.value)}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-[11px] transition-all ${
                          selected
                            ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm font-semibold'
                            : 'border-gray-200 text-gray-500 hover:border-slotted-200 hover:bg-gray-50'
                        }`}
                      >
                        {opt.emoji} {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Meetup buffer — slider */}
            <div className="mt-4">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Meetup buffer
              </label>
              <p className="mt-0.5 text-[10px] text-gray-400">Padding before/after each meetup</p>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={15}
                  value={travelBuffer}
                  onChange={(e) => setTravelBuffer(Number(e.target.value))}
                  className="flex-1 accent-teal-500 h-1.5 cursor-pointer"
                />
                <span className="min-w-[3rem] rounded-lg border border-slotted-200 bg-slotted-50 px-2 py-1 text-center text-[11px] font-bold text-slotted-700">
                  {travelBuffer} min
                </span>
              </div>
            </div>

            {/* Trip buffer — two toggles */}
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <span className="text-xs">✈️</span>
                <label className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                  Trip buffer
                </label>
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400">Block a recovery day around your trips</p>
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={tripBufferBefore}
                    onClick={() => setTripBufferBefore(!tripBufferBefore)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      tripBufferBefore ? 'bg-slotted-500' : 'bg-gray-200'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                      tripBufferBefore ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`} />
                  </button>
                  <span className="text-xs text-gray-600">Day before trip</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={tripBufferAfter}
                    onClick={() => setTripBufferAfter(!tripBufferAfter)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      tripBufferAfter ? 'bg-slotted-500' : 'bg-gray-200'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                      tripBufferAfter ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`} />
                  </button>
                  <span className="text-xs text-gray-600">Day after trip</span>
                </label>
              </div>
            </div>

            {/* Personal time protection — slider */}
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <span className="text-xs">🛡️</span>
                <label className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                  Protect personal time
                </label>
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400">How aggressively should Slotted protect your free time?</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-[10px] text-gray-400">Open</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={personalTimeProtection}
                  onChange={(e) => setPersonalTimeProtection(Number(e.target.value))}
                  className="flex-1 accent-teal-500 h-1.5 cursor-pointer"
                />
                <span className="text-[10px] text-gray-400">Max</span>
              </div>
              <p className="mt-1 text-center text-[10px] font-medium text-slotted-600">{personalTimeLabel}</p>
            </div>
          </div>

          {/* ─── Learned Preferences ─── */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-lg">🧠</span>
              <h2 className="text-sm font-semibold text-gray-900">Learned Preferences</h2>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-400">
              Slotted learns your habits as you log hangouts
            </p>

            {learnedPrefs.total_meetups_logged >= 3 ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {learnedPrefs.preferred_activity && (
                  <div className="flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2.5">
                    <span className="text-base">
                      {({ coffee: '☕', meal: '🍽️', drinks: '🍻', walk: '🚶', workout: '💪', movie: '🎬', game_night: '🎮', hangout: '😎', other: '✨' } as Record<string, string>)[learnedPrefs.preferred_activity] || '✨'}
                    </span>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-700">Activity</p>
                      <p className="text-[10px] text-gray-500 capitalize">{learnedPrefs.preferred_activity.replace('_', ' ')}</p>
                    </div>
                  </div>
                )}
                {learnedPrefs.avg_duration_min && (
                  <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
                    <span className="text-base">⏱️</span>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-700">Duration</p>
                      <p className="text-[10px] text-gray-500">
                        {learnedPrefs.avg_duration_min >= 60
                          ? `${Math.floor(learnedPrefs.avg_duration_min / 60)}h ${learnedPrefs.avg_duration_min % 60 > 0 ? `${learnedPrefs.avg_duration_min % 60}m` : ''}`
                          : `${learnedPrefs.avg_duration_min} min`}
                      </p>
                    </div>
                  </div>
                )}
                {learnedPrefs.preferred_time && (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2.5">
                    <span className="text-base">
                      {({ morning: '🌅', afternoon: '☀️', evening: '🌆', night: '🌙' } as Record<string, string>)[learnedPrefs.preferred_time] || '🕐'}
                    </span>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-700">Best time</p>
                      <p className="text-[10px] text-gray-500 capitalize">{learnedPrefs.preferred_time} {learnedPrefs.preferred_day ? `· ${learnedPrefs.preferred_day}s` : ''}</p>
                    </div>
                  </div>
                )}
                {learnedPrefs.planning_style && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5">
                    <span className="text-base">{learnedPrefs.planning_style === 'spontaneous' ? '⚡' : learnedPrefs.planning_style === 'planner' ? '📋' : '🔄'}</span>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-700">Style</p>
                      <p className="text-[10px] text-gray-500 capitalize">{learnedPrefs.planning_style}</p>
                    </div>
                  </div>
                )}
                <p className="col-span-2 text-center text-[10px] text-gray-400 pt-1">
                  Based on {learnedPrefs.total_meetups_logged} hangouts
                </p>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-4 text-center">
                <span className="text-xl">📊</span>
                <p className="mt-1 text-[11px] font-medium text-gray-600">
                  {learnedPrefs.total_meetups_logged === 0
                    ? 'No hangouts logged yet'
                    : `${learnedPrefs.total_meetups_logged} of 3 hangouts logged`}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-400">
                  Log at least 3 hangouts to start learning your patterns
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feedback */}
      <div className="mt-5 rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-50 to-fuchsia-50 text-base">
            💬
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Share Feedback</h2>
            <p className="mt-0.5 text-[11px] text-gray-400">
              Found a bug? Have an idea? Every message goes straight to the developer.
            </p>
          </div>
        </div>
        <textarea
          ref={feedbackRef}
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          placeholder="What's on your mind?"
          rows={2}
          className="mt-3 w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-all focus:border-slotted-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slotted-100"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[10px] text-gray-400">
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
            {feedbackSending ? 'Sending…' : feedbackSent ? 'Sent! Thank you ✓' : 'Send Feedback'}
          </button>
        </div>
      </div>
    </AppShell>
  );
}

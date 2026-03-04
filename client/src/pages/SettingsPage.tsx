import { useState, useRef, useEffect } from 'react';
import AppShell from '../components/AppShell';
import CalendarPicker from '../components/CalendarPicker';
import PushNotificationPrompt from '../components/PushNotificationPrompt';
import InstallPrompt from '../components/InstallPrompt';
import { useAuth } from '../contexts/AuthContext';
import { trackSettingsSaved } from '../lib/analytics';

export default function SettingsPage() {
  const { user, onboardingComplete, googleCalendarConnected, completeOnboarding, connectCalendar, disconnectCalendar, appleCalendarConnected, connectAppleCalendar, disconnectAppleCalendar, outlookCalendarConnected, connectOutlookCalendar, disconnectOutlookCalendar, signInWithGoogle, signOut } = useAuth();
  const [travelBuffer, setTravelBuffer] = useState(30);
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
  const [showCalendarDetails, setShowCalendarDetails] = useState(false);
  const [googleCalendarStale, setGoogleCalendarStale] = useState(false);
  const [showOutlookCalendarDetails, setShowOutlookCalendarDetails] = useState(false);

  const [socialRecharge, setSocialRecharge] = useState('2-3-week');
  const [rechargingDays, setRechargingDays] = useState<number[]>([]);
  const [shareHangouts, setShareHangouts] = useState(false);
  const [neighborhood, setNeighborhood] = useState('');
  const [workNeighborhood, setWorkNeighborhood] = useState('');
  const [officeDays, setOfficeDays] = useState<string[]>([]);
  const [officeVaries, setOfficeVaries] = useState(false);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  // Call windows for phone/video availability
  const [callWindows, setCallWindows] = useState<{ day: number; start: string; end: string; label: string }[]>([]);
  const [customCallDays, setCustomCallDays] = useState<Set<number>>(new Set());
  const [customCallStart, setCustomCallStart] = useState('12:00');
  const [customCallEnd, setCustomCallEnd] = useState('13:00');
  const [customCallLabel, setCustomCallLabel] = useState('');
  const [videoPlatforms, setVideoPlatforms] = useState<string[]>([]);

  // Scheduling preferences (moved from onboarding)
  const [socialGoal, setSocialGoal] = useState('');
  const [preferredDuration, setPreferredDuration] = useState('');
  const [preferredCallDuration, setPreferredCallDuration] = useState('');

  // Event interest preferences
  const [eventInterests, setEventInterests] = useState<string[]>([]);
  const [eventCity, setEventCity] = useState('');

  // Display name / nickname
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try{
        const token = await user.getIdToken();
        // Load user settings
        const meRes = await fetch('/api/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.social_frequency) setSocialRecharge(me.social_frequency);
          if (me.preferred_times) setPreferredTimes(me.preferred_times);
          if (me.travel_buffer_min) setTravelBuffer(me.travel_buffer_min);
          if (me.planning_style) setPlanningStyle(me.planning_style);
          if (me.recharging_days) setRechargingDays(me.recharging_days);
          if (me.share_hangouts !== undefined) setShareHangouts(me.share_hangouts);
          if (me.call_windows && Array.isArray(me.call_windows)) setCallWindows(me.call_windows);
          if (me.video_platforms && Array.isArray(me.video_platforms)) setVideoPlatforms(me.video_platforms);
          if (me.neighborhood) setNeighborhood(me.neighborhood);
          if (me.work_neighborhood) setWorkNeighborhood(me.work_neighborhood);
          if (me.office_days && Array.isArray(me.office_days)) {
            // Convert 0-6 integers to day names
            const dayMap: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
            setOfficeDays(me.office_days.map((d: number) => dayMap[d]).filter(Boolean));
          }
          if (me.office_schedule_varies !== undefined) setOfficeVaries(me.office_schedule_varies);
          if (me.social_goal) setSocialGoal(me.social_goal);
          if (me.preferred_duration) setPreferredDuration(me.preferred_duration);
          if (me.preferred_call_duration) setPreferredCallDuration(me.preferred_call_duration);
          if (me.event_interests) setEventInterests(me.event_interests);
          if (me.event_city) setEventCity(me.event_city);
          if (me.display_name) setDisplayName(me.display_name);
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
      
      // Convert day names to integers for officeDays
      const dayNameToInt: Record<string, number> = { 
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 
      };
      const officeDaysInts = officeDays.map(day => dayNameToInt[day]).filter(n => n !== undefined);
      
      const response = await fetch('/api/users/me/settings', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          socialFrequency: socialRecharge,
          preferredTimes,
          travelBuffer,
          rechargingDays,
          shareHangouts,
          planningStyle,
          neighborhood,
          workNeighborhood,
          officeDays: officeDaysInts,
          officeScheduleVaries: officeVaries,
          callWindows,
          videoPlatforms,
          socialGoal: socialGoal || undefined,
          preferredDuration: preferredDuration || undefined,
          preferredCallDuration: preferredCallDuration || undefined,
          eventInterests,
          eventCity,
          displayName: displayName.trim() || undefined,
        }),
      });
      if (!response.ok) {
        console.error('Settings save failed:', await response.text());
        alert('Failed to save settings. Please try again.');
        return;
      }
    } catch (err) {
      console.error('Settings save error:', err);
      alert('Failed to save settings. Please check your connection.');
      return;
    }
    if (!onboardingComplete) {
      completeOnboarding();
    }
    setSaved(true);
    trackSettingsSaved();
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

  return (
    <AppShell>
      {/* ── Header ── */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">Settings</h1>
          <p className="mt-0.5 text-xs text-gray-400">Customize how Slotted.ai works for you</p>
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

      <div className="space-y-6">

        {/* ═══════════════════════════════════════════════ */}
        {/* STEP 1: ACCOUNT & CALENDARS                    */}
        {/* ═══════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slotted-500 to-purple-600 text-xs font-bold text-white shadow-sm">1</span>
            <h2 className="text-sm font-bold text-gray-800">Account & Calendars</h2>
          </div>

          <div className="space-y-4 pl-4 sm:pl-10">
            {/* Profile & Calendar card */}
            <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="" className="h-10 w-10 rounded-full ring-2 ring-slotted-100" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-sm font-bold text-white">
                    {user?.displayName?.[0] ?? '?'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {editingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setEditingName(false); }}
                        className="w-full rounded-lg border border-slotted-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-slotted-200"
                        placeholder="Your display name"
                        autoFocus
                      />
                      <button
                        onClick={() => setEditingName(false)}
                        className="rounded-lg bg-slotted-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slotted-600 transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">{displayName || user?.displayName}</p>
                      <button
                        onClick={() => setEditingName(true)}
                        className="rounded-md p-1 text-gray-400 hover:text-slotted-500 hover:bg-slotted-50 transition-all"
                        title="Edit display name"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                </div>
              </div>

              {/* Calendar status — compact provider list */}
              <div className="mt-3 border-t border-gray-100 pt-3 space-y-1.5">
                {/* Google Calendar row */}
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white border border-gray-100 shadow-sm">
                      {googleIcon}
                    </div>
                    <span className="text-xs font-medium text-gray-700">Google</span>
                    {googleCalendarConnected && !googleCalendarStale ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                        Connected
                      </span>
                    ) : googleCalendarStale ? (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        Reconnect
                      </span>
                    ) : null}
                  </div>
                  {googleCalendarConnected && !googleCalendarStale ? (
                    <button onClick={() => setShowCalendarDetails(!showCalendarDetails)} className="text-[11px] font-medium text-slotted-600 hover:text-slotted-700">
                      {showCalendarDetails ? 'Hide' : 'Manage'}
                    </button>
                  ) : (
                    <button onClick={connectCalendar} className="rounded-lg gradient-btn px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition-all hover:shadow-md">
                      Connect
                    </button>
                  )}
                </div>

                {/* Google calendar details (expandable) */}
                {(showCalendarDetails && googleCalendarConnected) || googleCalendarStale ? (
                  <div className="ml-8 space-y-2 rounded-xl border border-gray-100 bg-gray-50/30 p-3">
                    <CalendarPicker source="google" onDisconnected={() => setGoogleCalendarStale(true)} />
                    {!googleCalendarStale && (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={async () => { disconnectCalendar(); await signOut(); signInWithGoogle(); }}
                        className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Switch
                      </button>
                      <button
                        onClick={disconnectCalendar}
                        className="flex-1 rounded-lg border border-red-100 bg-red-50/50 px-2 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50"
                      >
                        Disconnect
                      </button>
                    </div>
                    )}
                  </div>
                ) : null}

                {/* Apple Calendar row */}
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white border border-gray-100 shadow-sm text-sm">{'\u{1F34E}'}</div>
                    <span className="text-xs font-medium text-gray-700">Apple</span>
                    {appleCalendarConnected && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                        Connected
                      </span>
                    )}
                  </div>
                  {appleCalendarConnected ? (
                    <button onClick={() => setShowAppleCalendarDetails(!showAppleCalendarDetails)} className="text-[11px] font-medium text-slotted-600 hover:text-slotted-700">
                      {showAppleCalendarDetails ? 'Hide' : 'Manage'}
                    </button>
                  ) : (
                    <button onClick={() => setShowAppleConnect(!showAppleConnect)} className="rounded-lg gradient-btn px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition-all hover:shadow-md">
                      Connect
                    </button>
                  )}
                </div>

                {/* Apple calendar details (expandable) */}
                {showAppleCalendarDetails && appleCalendarConnected && (
                  <div className="ml-8 space-y-2 rounded-xl border border-gray-100 bg-gray-50/30 p-3">
                    <CalendarPicker source="apple" />
                    <div className="pt-1">
                      <button onClick={disconnectAppleCalendar} className="w-full rounded-lg border border-red-100 bg-red-50/50 px-2 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50">
                        Disconnect
                      </button>
                    </div>
                  </div>
                )}

                {/* Apple connect form (expandable) */}
                {showAppleConnect && !appleCalendarConnected && (
                  <div className="ml-8 rounded-xl border border-gray-200 bg-gray-50/50 p-3 space-y-2">
                    <p className="text-[11px] text-gray-600">
                      Enter your Apple ID and an <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium">app-specific password</a>.
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
                        <p>Apple doesn{"\'"}t offer a calendar API like Google, so all third-party apps use the same approach:</p>
                        <ol className="list-decimal list-inside space-y-0.5">
                          <li>Go to <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">appleid.apple.com</a> {'\u{2192}'} Sign-In and Security</li>
                          <li>Generate an App-Specific Password (name it {"\""}Slotted.ai{"\""})</li>
                          <li>Paste it below</li>
                        </ol>
                      </div>
                    )}
                    <input
                      type="email"
                      value={appleEmail}
                      onChange={(e) => { setAppleEmail(e.target.value); setAppleError(null); }}
                      placeholder="Apple ID email"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-slotted-400 focus:outline-none focus:ring-1 focus:ring-slotted-100"
                    />
                    <input
                      type="password"
                      value={applePassword}
                      onChange={(e) => { setApplePassword(e.target.value); setAppleError(null); }}
                      placeholder="App-specific password"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-slotted-400 focus:outline-none focus:ring-1 focus:ring-slotted-100"
                    />
                    {appleError && <p className="text-[11px] text-red-600">{appleError}</p>}
                    {appleSuccess && <p className="text-[11px] text-emerald-700">{'\u{2713}'} Connected!</p>}
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
                      {appleConnecting ? 'Connecting\u2026' : 'Connect'}
                    </button>
                  </div>
                )}

                {/* Outlook Calendar row */}
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white border border-gray-100 shadow-sm">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#0078d4"/>
                        <path d="M8 8h3.5v8H8V8zm4.5 0H16v8h-3.5V8z" fill="white" opacity="0.9"/>
                      </svg>
                    </div>
                    <span className="text-xs font-medium text-gray-700">Outlook</span>
                    {outlookCalendarConnected && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                        Connected
                      </span>
                    )}
                  </div>
                  {outlookCalendarConnected ? (
                    <button onClick={() => setShowOutlookCalendarDetails(!showOutlookCalendarDetails)} className="text-[11px] font-medium text-slotted-600 hover:text-slotted-700">
                      {showOutlookCalendarDetails ? 'Hide' : 'Manage'}
                    </button>
                  ) : (
                    <button onClick={connectOutlookCalendar} className="rounded-lg gradient-btn px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition-all hover:shadow-md">
                      Connect
                    </button>
                  )}
                </div>

                {/* Outlook calendar details (expandable) */}
                {showOutlookCalendarDetails && outlookCalendarConnected && (
                  <div className="ml-8 space-y-2 rounded-xl border border-gray-100 bg-gray-50/30 p-3">
                    <CalendarPicker source="outlook" />
                    <div className="pt-1">
                      <button onClick={disconnectOutlookCalendar} className="w-full rounded-lg border border-red-100 bg-red-50/50 px-2 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50">
                        Disconnect
                      </button>
                    </div>
                  </div>
                )}

                {/* Single privacy/help note */}
                {(googleCalendarConnected || appleCalendarConnected || outlookCalendarConnected) ? (
                  <p className="mt-2 text-[10px] text-gray-400 leading-relaxed">
                    {'\u{1F512}'} Friends only see free or busy — never event details. You can disconnect anytime.
                  </p>
                ) : (
                  <p className="mt-2 text-[10px] text-gray-400 leading-relaxed">
                    Connect at least one calendar so Slotted.ai can find times that work. We only read busy/free — never event details.
                  </p>
                )}
              </div>
            </div>
            <InstallPrompt alwaysShow desktopOnly />
            <PushNotificationPrompt mobileOnly />

            {/* Share hangout activity */}
            <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">👥</span>
                    <label className="text-[11px] font-semibold text-gray-700">
                      Share hangout activity
                    </label>
                  </div>
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    {shareHangouts
                      ? 'Friends see "You caught up with [Name]" when both have this on'
                      : 'Your hangouts are completely private'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={shareHangouts}
                  onClick={() => setShareHangouts(!shareHangouts)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    shareHangouts ? 'bg-slotted-500' : 'bg-gray-200'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    shareHangouts ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`} />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════ */}
        {/* STEP 2: PLANNING STYLE                         */}
        {/* ═══════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slotted-500 to-purple-600 text-xs font-bold text-white shadow-sm">2</span>
            <h2 className="text-sm font-bold text-gray-800">Planning Style</h2>
          </div>

          <div className="space-y-4 pl-4 sm:pl-10">
            <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { value: 'spontaneous', emoji: '\u26A1', label: 'Spontaneous', desc: 'Same-day & next-day plans, "are you free tonight?" nudges' },
                  { value: 'flexible', emoji: '\uD83D\uDD04', label: 'Flexible', desc: 'Adapts per friendship \u2014 books ahead with planners, last-minute with spontaneous friends' },
                  { value: 'planner', emoji: '\uD83D\uDCCB', label: 'Planner', desc: 'Plans 1\u20134 weeks out, recurring hangouts, early confirmations' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPlanningStyle(opt.value)}
                    className={`rounded-xl border px-4 py-4 text-center transition-all ${
                      planningStyle === opt.value
                        ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 shadow-md ring-1 ring-slotted-200'
                        : 'border-gray-200 text-gray-600 hover:border-slotted-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-2xl">{opt.emoji}</span>
                    <p className={`mt-1.5 text-xs font-bold ${planningStyle === opt.value ? 'text-slotted-700' : 'text-gray-800'}`}>{opt.label}</p>
                    <p className={`mt-1 text-[10px] leading-snug ${planningStyle === opt.value ? 'text-slotted-600' : 'text-gray-400'}`}>{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════ */}
        {/* STEP 3: SOCIAL BATTERY                         */}
        {/* ═══════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slotted-500 to-purple-600 text-xs font-bold text-white shadow-sm">3</span>
            <h2 className="text-sm font-bold text-gray-800">Social Battery</h2>
          </div>

          <div className="space-y-4 pl-4 sm:pl-10">
            <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
              <label className="block text-[11px] font-semibold text-gray-700 mb-2">How often do you want to see friends?</label>
              <div className="grid grid-cols-1 gap-2">
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

              {/* Recharging days */}
              <div className="mt-3 border-t border-gray-100 pt-3">
                <label className="block text-[11px] font-semibold text-gray-700">
                  No-plans days
                </label>
                <p className="mt-0.5 text-[10px] text-gray-400">Slotted.ai won't suggest hangouts on these days</p>
                <div className="mt-2 grid grid-cols-7 gap-1.5">
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
                        className={`flex items-center justify-center rounded-lg border py-2 text-xs font-medium transition-all ${
                          selected
                            ? 'border-red-300 bg-red-50 text-red-700'
                            : 'border-gray-200 text-gray-500 hover:border-red-200 hover:bg-red-50/50'
                        }`}
                      >
                        {selected ? '🔴 ' : ''}{label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Summary */}
              {rechargingDays.length > 0 && (
              <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-1.5">
                <p className="text-[10px] text-gray-400">
                  No plans on {rechargingDays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}
                </p>
              </div>
              )}

              {/* Social goal */}
              <div className="mt-3 border-t border-gray-100 pt-3">
                <label className="block text-[11px] font-semibold text-gray-700">
                  Social goal
                </label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[
                    { value: 'increase', emoji: '📈', label: 'See people more' },
                    { value: 'maintain', emoji: '⚖️', label: 'Stay the same' },
                    { value: 'decrease', emoji: '📉', label: 'More downtime' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSocialGoal(opt.value)}
                      className={`rounded-lg border px-3 py-2 text-center text-xs transition-all ${
                        socialGoal === opt.value
                          ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm font-semibold'
                          : 'border-gray-200 text-gray-500 hover:border-slotted-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-base">{opt.emoji}</span>
                      <p className="mt-1 text-[10px] leading-tight">{opt.label}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════ */}
        {/* STEP 4: HOW YOU CONNECT (THE CENTERPIECE)      */}
        {/* ═══════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slotted-500 to-purple-600 text-xs font-bold text-white shadow-sm">4</span>
            <h2 className="text-sm font-bold text-gray-800">How You Connect</h2>
          </div>

          <div className="pl-4 sm:pl-10 grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">

            {/* ─── IN-PERSON HANGOUTS CARD (teal) ─── */}
            <div className="rounded-2xl border-2 border-teal-200 bg-gradient-to-b from-teal-50/60 to-white p-4 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 text-lg shadow-sm">📍</div>
                <div>
                  <h3 className="text-sm font-bold text-teal-900">In-Person Hangouts</h3>
                  <p className="text-[10px] text-teal-600/80">For friends nearby</p>
                </div>
              </div>

              {/* Neighborhoods */}
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">Neighborhoods</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium uppercase tracking-wider text-gray-400">Home</label>
                      <input
                        type="text"
                        value={neighborhood}
                        onChange={(e) => setNeighborhood(e.target.value)}
                        placeholder="e.g. West Village, NYC"
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium uppercase tracking-wider text-gray-400">Work</label>
                      <input
                        type="text"
                        value={workNeighborhood}
                        onChange={(e) => setWorkNeighborhood(e.target.value)}
                        placeholder="e.g. Midtown, NYC"
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-100"
                      />
                    </div>
                  </div>
                </div>

                {/* Office days */}
                <div className="border-t border-teal-100 pt-3">
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1.5">Office days</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex gap-1">
                      {['M', 'Tu', 'W', 'Th', 'F'].map((day) => {
                        const fullDay = ({ M: 'Mon', Tu: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri' } as Record<string, string>)[day]!;
                        const isSelected = officeDays.includes(fullDay);
                        return (
                          <button
                            key={day}
                            onClick={() => { if (!officeVaries) toggleOfficeDay(fullDay); }}
                            disabled={officeVaries}
                            className={`h-10 w-10 rounded-lg border text-[11px] font-bold transition-all ${
                              officeVaries
                                ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                : isSelected
                                  ? 'border-teal-400 bg-teal-50 text-teal-700 shadow-sm'
                                  : 'border-gray-200 text-gray-500 hover:border-teal-200 hover:bg-gray-50'
                            }`}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => { setOfficeVaries(!officeVaries); if (!officeVaries) setOfficeDays([]); }}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                        officeVaries
                          ? 'border-teal-400 bg-teal-50 text-teal-700 shadow-sm'
                          : 'border-gray-200 text-gray-500 hover:border-teal-200 hover:bg-gray-50'
                      }`}
                    >
                      Varies
                    </button>
                  </div>
                </div>

                {/* Preferred times for in-person */}
                <div className="border-t border-teal-100 pt-3">
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1.5">When are you free?</label>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Weekdays */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Weekdays</p>
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
                                ? 'border-teal-400 bg-teal-50 text-teal-700 shadow-sm font-semibold'
                                : 'border-gray-200 text-gray-500 hover:border-teal-200 hover:bg-gray-50'
                            }`}
                          >
                            {opt.emoji} {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {/* Weekends */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Weekends</p>
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
                                ? 'border-teal-400 bg-teal-50 text-teal-700 shadow-sm font-semibold'
                                : 'border-gray-200 text-gray-500 hover:border-teal-200 hover:bg-gray-50'
                            }`}
                          >
                            {opt.emoji} {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Default hangout duration */}
                <div className="border-t border-teal-100 pt-3">
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1.5">Default hangout length</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { value: 'quick', emoji: '⚡', label: '30–60 min' },
                      { value: 'medium', emoji: '☕', label: '1–2 hrs' },
                      { value: 'long', emoji: '🍽️', label: '2–4 hrs' },
                      { value: 'half-day', emoji: '🎉', label: '4+ hrs' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setPreferredDuration(opt.value)}
                        className={`rounded-lg border px-3 py-2 text-[11px] transition-all ${
                          preferredDuration === opt.value
                            ? 'border-teal-400 bg-teal-50 text-teal-700 shadow-sm font-semibold'
                            : 'border-gray-200 text-gray-500 hover:border-teal-200 hover:bg-gray-50'
                        }`}
                      >
                        {opt.emoji} {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Travel buffer */}
                <div className="border-t border-teal-100 pt-3">
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1.5">Travel buffer</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={60}
                      step={15}
                      value={travelBuffer}
                      onChange={(e) => setTravelBuffer(Number(e.target.value))}
                      className="flex-1 accent-teal-500 h-1.5 cursor-pointer"
                    />
                    <span className="min-w-[3rem] rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-center text-[11px] font-bold text-teal-700">
                      {travelBuffer} min
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── CALLS & FACETIME CARD (violet) ─── */}
            <div className="rounded-2xl border-2 border-violet-200 bg-gradient-to-b from-violet-50/60 to-white p-4 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-lg shadow-sm">📞</div>
                <div>
                  <h3 className="text-sm font-bold text-violet-900">Calls & FaceTime</h3>
                  <p className="text-[10px] text-violet-600/80">For long-distance friends</p>
                </div>
              </div>

              {/* Default call duration */}
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-violet-700 mb-2">Default call length</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { value: 'quick', emoji: '💬', label: '10–20 min' },
                    { value: 'medium', emoji: '📱', label: '30–60 min' },
                    { value: 'long', emoji: '📞', label: '1–2 hrs' },
                    { value: 'none', emoji: '🙅', label: "I don't do calls" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setPreferredCallDuration(opt.value)}
                      className={`rounded-lg border px-3 py-2 text-[11px] transition-all ${
                        preferredCallDuration === opt.value
                          ? 'border-violet-400 bg-violet-50 text-violet-700 shadow-sm font-semibold'
                          : 'border-gray-200 text-gray-500 hover:border-violet-200 hover:bg-violet-50/50'
                      }`}
                    >
                      {opt.emoji} {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preferred video platforms */}
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-violet-700 mb-2">Preferred video call platforms</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { value: 'phone', emoji: '📞', label: 'Phone Call' },
                    { value: 'facetime', emoji: '📱', label: 'FaceTime' },
                    { value: 'zoom', emoji: '📹', label: 'Zoom' },
                    { value: 'google_meet', emoji: '🌐', label: 'Google Meet' },
                    { value: 'teams', emoji: '💼', label: 'Teams' },
                    { value: 'whatsapp', emoji: '💬', label: 'WhatsApp' },
                  ].map((p) => {
                    const selected = videoPlatforms.includes(p.value);
                    return (
                      <button
                        key={p.value}
                        onClick={() => setVideoPlatforms((prev) =>
                          selected ? prev.filter((v) => v !== p.value) : [...prev, p.value]
                        )}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          selected
                            ? 'border-violet-400 bg-violet-50 text-violet-700 shadow-sm'
                            : 'border-gray-200 text-gray-500 hover:border-violet-200 hover:bg-violet-50/50'
                        }`}
                      >
                        {p.emoji} {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[10px] text-gray-400">Friends see your preferences when scheduling calls</p>
              </div>

              {/* Existing windows */}
              {callWindows.length > 0 && (
                <div className="space-y-2 mb-3">
                  {callWindows.map((w, idx) => {
                    const dayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][w.day] || '?';
                    return (
                      <div key={idx} className="flex items-center justify-between rounded-xl border border-violet-100 bg-violet-50/30 px-3 py-2">
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

              {callWindows.length === 0 && (
                <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/20 px-4 py-5 text-center mb-3">
                  <p className="text-xs text-violet-400">No call windows yet</p>
                  <p className="text-[10px] text-gray-400 mt-1">Add preset times below or create a custom window</p>
                </div>
              )}

              {/* Quick-add presets */}
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-2">Quick add</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '🥪 Weekday lunch', days: [1,2,3,4,5], start: '12:00', end: '13:00', tag: 'Lunch break' },
                    { label: '🚗 Morning commute', days: [1,2,3,4,5], start: '07:30', end: '09:00', tag: 'Commute' },
                    { label: '🚙 Evening commute', days: [1,2,3,4,5], start: '17:00', end: '18:30', tag: 'Commute' },
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
                        setCallWindows((prev) => {
                          const existing = new Set(prev.map((w) => `${w.day}-${w.start}-${w.end}`));
                          const unique = newWindows.filter((w) => !existing.has(`${w.day}-${w.start}-${w.end}`));
                          return [...prev, ...unique];
                        });
                      }}
                      className="rounded-lg border border-violet-200 px-3 py-1.5 text-[11px] font-medium text-gray-600 transition-all hover:border-violet-400 hover:bg-violet-50"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom add */}
              <details className="mt-3">
                <summary className="text-[11px] font-medium text-violet-500 hover:text-violet-700 cursor-pointer transition-colors">
                  + Add custom window
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1.5">Select days</label>
                    <div className="flex gap-1.5">
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            setCustomCallDays((prev) => {
                              const next = new Set(prev);
                              if (next.has(i)) next.delete(i);
                              else next.add(i);
                              return next;
                            });
                          }}
                          className={`flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium transition-all ${
                            customCallDays.has(i)
                              ? 'border-violet-400 bg-violet-50 text-violet-700'
                              : 'border-gray-200 text-gray-500 hover:border-violet-200'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Start</label>
                      <input
                        type="time"
                        value={customCallStart}
                        onChange={(e) => setCustomCallStart(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-violet-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">End</label>
                      <input
                        type="time"
                        value={customCallEnd}
                        onChange={(e) => setCustomCallEnd(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-violet-400 focus:outline-none"
                      />
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="block text-[10px] text-gray-400 mb-0.5">Label (optional)</label>
                      <input
                        type="text"
                        value={customCallLabel}
                        onChange={(e) => setCustomCallLabel(e.target.value)}
                        placeholder="e.g. Lunch"
                        className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-violet-400 focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => {
                        if (customCallDays.size > 0 && customCallStart && customCallEnd) {
                          const newWindows = Array.from(customCallDays).map((day) => ({
                            day,
                            start: customCallStart,
                            end: customCallEnd,
                            label: customCallLabel,
                          }));
                          setCallWindows((prev) => {
                            const existing = new Set(prev.map((w) => `${w.day}-${w.start}-${w.end}`));
                            const unique = newWindows.filter((w) => !existing.has(`${w.day}-${w.start}-${w.end}`));
                            return [...prev, ...unique];
                          });
                          setCustomCallDays(new Set());
                          setCustomCallStart('12:00');
                          setCustomCallEnd('13:00');
                          setCustomCallLabel('');
                        }
                      }}
                      disabled={customCallDays.size === 0}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════ */}
        {/* STEP 5: EVENT INTERESTS                        */}
        {/* ═══════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slotted-500 to-purple-600 text-xs font-bold text-white shadow-sm">5</span>
            <h2 className="text-sm font-bold text-gray-800">Event Interests</h2>
          </div>

          <div className="space-y-4 pl-4 sm:pl-10">
            <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
              {/* Event types */}
              <div>
                <label className="text-[11px] font-semibold text-gray-700">
                  What are you into?
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    { value: 'theater', label: 'Theater & Broadway', emoji: '🎭' },
                    { value: 'concerts', label: 'Concerts & Live Music', emoji: '🎵' },
                    { value: 'sports', label: 'Sports Games', emoji: '⚽' },
                    { value: 'comedy', label: 'Comedy Shows', emoji: '😂' },
                    { value: 'festivals', label: 'Festivals', emoji: '🎪' },
                    { value: 'dance', label: 'Dance & Ballet', emoji: '💃' },
                    { value: 'opera', label: 'Opera & Classical', emoji: '🎻' },
                  ].map((interest) => {
                    const selected = eventInterests.includes(interest.value);
                    return (
                      <button
                        key={interest.value}
                        type="button"
                        onClick={() => {
                          setEventInterests((prev) =>
                            prev.includes(interest.value)
                              ? prev.filter((v) => v !== interest.value)
                              : [...prev, interest.value]
                          );
                        }}
                        className={`rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                          selected
                            ? 'border-slotted-400 bg-slotted-50 text-slotted-700 shadow-sm'
                            : 'border-gray-200 text-gray-500 hover:border-slotted-200 hover:bg-slotted-50/30'
                        }`}
                      >
                        {interest.emoji} {interest.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Default city */}
              <div className="mt-4 border-t border-gray-100 pt-3">
                <label className="text-[11px] font-semibold text-gray-700">
                  Default city for events
                </label>
                <input
                  type="text"
                  value={eventCity}
                  onChange={(e) => setEventCity(e.target.value)}
                  placeholder="e.g. New York, Los Angeles, Chicago"
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Feedback */}
        <div className="pl-4 sm:pl-10">
            <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-50 to-fuchsia-50 text-base">
                💬
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-900">Feedback</h2>
              <p className="text-[10px] text-gray-400">
                Bug or idea? Goes straight to the developer.
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
              {feedbackSending ? 'Sending\u2026' : feedbackSent ? 'Sent! Thank you \u2713' : 'Send Feedback'}
            </button>
          </div>
        </div>
        </div>
      </div>
    </AppShell>
  );
}

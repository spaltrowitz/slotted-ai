import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getFirstName } from '../lib/utils';

interface EventInviteData {
  valid: boolean;
  eventTitle: string;
  inviterName: string;
  groupMembers: string[];
  venue: string;
  dateCount?: number;
  imageUrl?: string;
  eventScheduleId?: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function EventInviteLandingPage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading, signInWithGoogle, connectCalendar, calendarConnected } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<EventInviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [phase, setPhase] = useState<'preview' | 'calendar' | 'done'>('preview');

  // Fetch invite data (no auth required)
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/events/invite/${token}`);
        if (!res.ok) throw new Error('Invalid invite');
        const data: EventInviteData = await res.json();
        if (!data.valid) throw new Error('Expired');
        setInvite(data);
      } catch {
        setError("This invite link isn't valid or has expired. Ask your friend for a new one!");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // After sign-in, move to calendar phase or accept directly
  useEffect(() => {
    if (!user || !invite || phase !== 'preview') return;
    if (calendarConnected) {
      acceptInvite();
    } else {
      setPhase('calendar');
    }
  }, [user, invite, calendarConnected]);

  const acceptInvite = async () => {
    if (!token || accepting) return;
    setAccepting(true);
    try {
      const { auth } = await import('../lib/firebase');
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      const idToken = await currentUser.getIdToken();
      await fetch(`${API_BASE}/events/invite/${token}/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });
      setPhase('done');
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch {
      // Still redirect — they're in the system
      setPhase('done');
      setTimeout(() => navigate('/dashboard'), 1500);
    } finally {
      setAccepting(false);
    }
  };

  const handleJoinClick = async () => {
    if (user) {
      if (calendarConnected) {
        await acceptInvite();
      } else {
        setPhase('calendar');
      }
    } else {
      await signInWithGoogle();
    }
  };

  const handleConnectCalendar = async () => {
    // Store token so we can pick up after OAuth redirect
    localStorage.setItem('slotted_pending_event_invite', token || '');
    await connectCalendar();
  };

  const handleSkipCalendar = () => {
    acceptInvite();
  };

  // Loading state
  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-purple-50 via-white to-amber-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slotted-300 border-t-slotted-600" />
      </div>
    );
  }

  // Error state
  if (error || !invite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-purple-50 via-white to-amber-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
          <div className="mb-4 text-4xl">😕</div>
          <h1 className="mb-2 text-lg font-bold text-gray-900">Invite Not Found</h1>
          <p className="mb-6 text-sm text-gray-500">{error}</p>
          <Link to="/" className="text-sm font-medium text-slotted-600 hover:text-slotted-700">
            Go to Slotted.ai →
          </Link>
        </div>
      </div>
    );
  }

  // Done state — accepted
  if (phase === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-purple-50 via-white to-amber-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
          <div className="mb-4 text-4xl">🎉</div>
          <h1 className="mb-2 text-lg font-bold text-gray-900">You're in!</h1>
          <p className="text-sm text-gray-500">Taking you to pick a showtime…</p>
        </div>
      </div>
    );
  }

  // Calendar connect phase
  if (phase === 'calendar') {
    return (
      <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-purple-50 via-white to-amber-50">
        <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-purple-200/40 via-pink-100/30 to-transparent blur-3xl" />
        <div className="absolute bottom-0 -left-32 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-amber-200/40 via-orange-100/30 to-transparent blur-3xl" />

        <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
          <div className="w-full rounded-2xl bg-white p-8 shadow-xl text-center space-y-5">
            <div className="text-4xl">📅</div>
            <h1 className="text-xl font-bold text-gray-900">Connect your calendar</h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              So we can find times that work for everyone — we'll check your availability
              and suggest showtimes when you're all free.
            </p>

            <div className="rounded-xl bg-purple-50 border border-purple-100 p-4 text-left space-y-2">
              <p className="text-xs font-medium text-purple-800">What we check:</p>
              <ul className="text-xs text-purple-700 space-y-1">
                <li className="flex items-center gap-2">✓ Only busy/free status</li>
                <li className="flex items-center gap-2">✓ Never event titles or details</li>
                <li className="flex items-center gap-2">✓ Disconnect anytime in settings</li>
              </ul>
            </div>

            <button
              onClick={handleConnectCalendar}
              className="w-full rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              Connect Google Calendar
            </button>

            <button
              onClick={handleSkipCalendar}
              className="w-full text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              Skip for now — I'll pick times manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main landing page — pre-auth preview
  const inviterFirst = getFirstName(invite.inviterName);
  const othersText = invite.groupMembers.length > 0
    ? invite.groupMembers.map(getFirstName).join(', ')
    : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-purple-50 via-white to-amber-50">
      {/* Background blobs */}
      <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-purple-200/40 via-pink-100/30 to-transparent blur-3xl" />
      <div className="absolute bottom-0 -left-32 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-amber-200/40 via-orange-100/30 to-transparent blur-3xl" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-center px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 text-sm font-bold text-white shadow-md">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-gray-900">Slotted.ai</span>
        </Link>
      </nav>

      {/* Content */}
      <div className="relative z-10 mx-auto flex min-h-[calc(100dvh-80px)] max-w-md flex-col items-center justify-center px-6 pb-12">
        <div className="w-full space-y-5">

          {/* Inviter badge */}
          <div className="flex items-center justify-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 border border-gray-100 px-4 py-2 shadow-sm backdrop-blur">
              <span className="text-sm">🎭</span>
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{inviterFirst}</span> invited you!
              </span>
            </div>
          </div>

          {/* Event hero card */}
          <div className="rounded-2xl bg-white p-6 shadow-xl space-y-4">
            {invite.imageUrl && (
              <img
                src={invite.imageUrl}
                alt={invite.eventTitle}
                className="w-full h-40 rounded-xl object-cover"
                loading="lazy"
              />
            )}

            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-gray-900">{invite.eventTitle}</h1>
              <p className="text-sm text-gray-500 flex items-center gap-1.5">
                📍 {invite.venue}
              </p>
            </div>

            <p className="text-sm text-gray-600 leading-relaxed">
              {inviterFirst} invited you to pick a showtime
              {invite.groupMembers.length > 0 ? ' together' : ''}!
            </p>

            {/* Social proof */}
            {othersText && (
              <div className="flex items-center gap-2 rounded-xl bg-purple-50/60 border border-purple-100/50 px-4 py-3">
                <span className="text-sm">👥</span>
                <p className="text-xs text-purple-800">
                  {inviterFirst}, {othersText} are also picking a time
                </p>
              </div>
            )}

            {/* Date count */}
            {invite.dateCount && invite.dateCount > 0 && (
              <p className="text-xs text-gray-500">
                🗓️ {invite.dateCount} available date{invite.dateCount > 1 ? 's' : ''} to choose from
              </p>
            )}

            {/* CTA */}
            <button
              onClick={handleJoinClick}
              className="w-full rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-4 text-base font-semibold text-white shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
            >
              Join & Pick a Time
            </button>

            <p className="text-center text-xs text-gray-500">
              Free · Google sign-in · Takes 30 seconds
            </p>
          </div>

          {/* Footer */}
          <p className="text-center text-[11px] text-gray-500">
            Powered by <Link to="/" className="underline hover:text-gray-400">Slotted.ai</Link> — find time to hang with friends
          </p>
        </div>
      </div>
    </div>
  );
}

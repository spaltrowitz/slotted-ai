import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { getFirstName } from '../lib/utils';

interface Inviter {
  uid: string;
  displayName: string;
  photoUrl: string | null;
}

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [inviter, setInviter] = useState<Inviter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!code) return;
    (async () => {
      try {
        const { data } = await api.get(`/users/invite/${code}`);
        setInviter(data);
      } catch {
        setError("This invite link doesn't seem to be valid. Ask your friend for a new one!");
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  // Auto-send friend request when logged-in user lands on invite page
  useEffect(() => {
    if (!user || !inviter || connected || connecting) return;
    (async () => {
      setConnecting(true);
      try {
        await api.post('/friends/invite', { userId: inviter.uid });
        setConnected(true);
        setTimeout(() => navigate('/dashboard'), 2000);
      } catch {
        // May already be friends — redirect anyway
        setConnected(true);
        setTimeout(() => navigate('/dashboard'), 1500);
      } finally {
        setConnecting(false);
      }
    })();
  }, [user, inviter, connected, connecting, navigate]);

  if (loading || authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-page-light">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slotted-400 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-page-warm">
      <div className="absolute -top-32 -right-32 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-amber-200/50 via-orange-200/30 to-transparent blur-3xl" />
      <div className="absolute top-1/2 -left-40 h-[500px] w-[500px] rounded-full bg-gradient-to-tr from-teal-200/40 via-cyan-100/30 to-transparent blur-3xl" />

      <nav className="relative z-10 flex items-center justify-between px-8 py-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-btn text-sm font-bold text-white shadow-md">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-gray-900">Slotted.ai</span>
        </Link>
      </nav>

      <div className="relative z-10 mx-auto max-w-md px-6 pt-20 pb-10 text-center">
        {error ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
            <span className="text-4xl">😕</span>
            <h2 className="mt-4 font-display text-xl font-bold text-gray-900">Hmm, that link didn't work</h2>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">{error}</p>
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-2 rounded-xl gradient-btn px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg"
            >
              Go to Slotted.ai
            </Link>
          </div>
        ) : inviter && !user ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
            {inviter.photoUrl ? (
              <img src={inviter.photoUrl} alt="" className="mx-auto h-16 w-16 rounded-full ring-4 ring-slotted-100 shadow-md" loading="lazy" />
            ) : (
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-indigo-500 text-xl font-bold text-white ring-4 ring-slotted-100 shadow-md">
                {inviter.displayName?.[0] ?? '?'}
              </div>
            )}
            <h2 className="mt-5 font-display text-xl font-bold text-gray-900">
              {getFirstName(inviter.displayName)} invited you!
            </h2>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              Join Slotted.ai to find the perfect time to hang out. It syncs your calendars so you never have to text back and forth.
            </p>
            <button
              onClick={signInWithGoogle}
              className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-xl gradient-btn px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              Sign up & connect with {getFirstName(inviter.displayName)}
            </button>
            <p className="mt-3 text-xs text-gray-500">Free · Takes 30 seconds · Google sign-in</p>
          </div>
        ) : connected ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
            <span className="text-4xl"></span>
            <h2 className="mt-4 font-display text-xl font-bold text-gray-900">You're connected!</h2>
            <p className="mt-2 text-sm text-gray-500">Taking you to your friends…</p>
          </div>
        ) : connecting ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slotted-400 border-t-transparent" />
            <p className="mt-4 text-sm text-gray-500">Connecting you with {getFirstName(inviter?.displayName)}…</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
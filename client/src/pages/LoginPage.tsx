import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { user, loading, signInWithGoogle, authError } = useAuth();

  // Capture referral param from invite links (e.g. ?ref=abc123)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('slotted_referrer', ref);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#faf9f7]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f8f7f4]">
      {/* Warm gradient mesh — colorful but sophisticated */}
      <div className="absolute -top-32 -right-32 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-amber-200/50 via-orange-200/30 to-transparent blur-3xl" />
      <div className="absolute top-1/2 -left-40 h-[500px] w-[500px] rounded-full bg-gradient-to-tr from-teal-200/40 via-cyan-100/30 to-transparent blur-3xl" />
      <div className="absolute -bottom-20 right-1/4 h-[400px] w-[400px] rounded-full bg-gradient-to-tl from-violet-200/30 via-fuchsia-100/20 to-transparent blur-3xl" />

      {/* Sticky nav */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-btn text-sm font-bold text-white shadow-md">S</div>
          <span className="font-display text-xl font-bold tracking-tight text-gray-900">Slotted</span>
        </div>
        {user && (
          <Link
            to="/dashboard"
            className="rounded-xl border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-gray-300 shadow-sm"
          >
            Dashboard →
          </Link>
        )}
      </nav>

      {/* Hero section */}
      <div className="relative z-10 mx-auto max-w-3xl px-6 pt-16 pb-10 text-center">
        <h1 className="font-display text-5xl font-extrabold tracking-tight text-gray-900 sm:text-6xl leading-[1.1]">
          Stop texting back and forth.{' '}
          <span className="gradient-text">Just hang out.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-gray-500">
          Slotted syncs your Google Calendar with your friends, finds the best time to meet using AI,
          and puts it on both calendars — no more back-and-forth.
        </p>

        {/* CTA */}
        <div className="mt-8 flex flex-col items-center gap-3">
          {user ? (
            <Link
              to="/dashboard"
              className="flex items-center justify-center gap-3 rounded-2xl gradient-btn px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-500/20 transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
            >
              Go to Dashboard →
            </Link>
          ) : (
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <button
                onClick={signInWithGoogle}
                className="flex items-center justify-center gap-3 rounded-2xl gradient-btn px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-500/20 transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff" fillOpacity=".7" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" fillOpacity=".8" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" fillOpacity=".6" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" fillOpacity=".7" />
                </svg>
                Get started with Google
              </button>
              <button
                onClick={signInWithGoogle}
                className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-8 py-4 text-base font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300 hover:-translate-y-0.5 active:translate-y-0"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Log back in
              </button>
            </div>
          )}

          {authError && (
            <div className="mt-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-600">
              {authError}
            </div>
          )}
        </div>
      </div>

      {/* How it works — compact 3-column */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-8">
        <h2 className="font-display text-center text-xs font-semibold uppercase tracking-widest text-gray-400 mb-6">
          How it works
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              step: '1',
              emoji: '📅',
              title: 'Connect your calendar',
              desc: 'Sign in with Google — we only see free/busy times, never event details.',
              color: 'from-blue-50 to-cyan-50',
              border: 'border-blue-100',
            },
            {
              step: '2',
              emoji: '👋',
              title: 'Invite your friends',
              desc: 'Share a link. When they join, calendars sync and Slotted finds mutual free time.',
              color: 'from-violet-50 to-fuchsia-50',
              border: 'border-violet-100',
            },
            {
              step: '3',
              emoji: '✨',
              title: 'Get smart suggestions',
              desc: 'AI picks the best times. Accept a slot and it goes on both calendars.',
              color: 'from-amber-50 to-orange-50',
              border: 'border-amber-100',
            },
          ].map((item) => (
            <div
              key={item.step}
              className={`rounded-2xl border ${item.border} bg-gradient-to-br ${item.color} p-5 shadow-sm`}
            >
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-gray-900 shadow-sm ring-1 ring-gray-200/60">
                  {item.step}
                </span>
                <span className="text-xl">{item.emoji}</span>
              </div>
              <h3 className="font-display text-sm font-bold text-gray-900">{item.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 pb-8 text-center text-xs text-gray-400">
        Made with ❤️ for people who want to see their friends more
      </footer>
    </div>
  );
}

import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { user, loading, signInWithGoogle, isSigningIn, authError } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#faf9f7]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f8f7f4]">
      {/* Warm gradient mesh — colorful but sophisticated */}
      <div className="absolute -top-32 -right-32 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-amber-200/50 via-orange-200/30 to-transparent blur-3xl" />
      <div className="absolute top-1/2 -left-40 h-[500px] w-[500px] rounded-full bg-gradient-to-tr from-teal-200/40 via-cyan-100/30 to-transparent blur-3xl" />
      <div className="absolute -bottom-20 right-1/4 h-[400px] w-[400px] rounded-full bg-gradient-to-tl from-violet-200/30 via-fuchsia-100/20 to-transparent blur-3xl" />

      {/* Sticky nav */}
      <nav className="relative z-10 flex items-center justify-between px-4 sm:px-8 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-btn text-sm font-bold text-white shadow-md">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-gray-900">Slotted.ai</span>
        </div>
      </nav>

      {/* Hero section */}
      <div className="relative z-10 mx-auto max-w-3xl px-6 pt-6 sm:pt-16 pb-6 sm:pb-10 text-center">
        <div className="mb-3 sm:mb-5 inline-flex items-center rounded-full border border-amber-200/60 bg-gradient-to-r from-amber-50/90 to-orange-50/90 px-4 py-1.5 text-xs font-semibold text-amber-800 shadow-sm backdrop-blur-sm">
          Early access — limited spots
        </div>
        <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-gray-900 sm:leading-[1.1] leading-[1.15]">
          Stop texting back and forth.{' '}
          <span className="gradient-text">Just hang out.</span>
        </h1>
        <p className="mx-auto mt-3 sm:mt-5 max-w-xl text-sm sm:text-base leading-relaxed text-gray-500">
          Slotted.ai connects to your calendar, finds when you and your friends are both free, and makes it easy to actually make plans.
        </p>

        {/* CTA */}
        <div className="mt-5 sm:mt-8 flex flex-col items-center gap-3">
          {
            <>
              <button
                onClick={signInWithGoogle}
                disabled={isSigningIn}
                className="flex items-center justify-center gap-3 rounded-2xl gradient-btn px-6 sm:px-8 py-3 sm:py-4 text-sm sm:text-base font-semibold text-white shadow-lg shadow-teal-500/20 transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff" fillOpacity=".7" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" fillOpacity=".8" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" fillOpacity=".6" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" fillOpacity=".7" />
                </svg>
                Get started with Google
              </button>
              <button
                onClick={signInWithGoogle}
                disabled={isSigningIn}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Already have an account? Log in
              </button>
            </>
          }

          {authError && (
            <div className="mt-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-600">
              {authError}
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-6 sm:pb-10">
        <h2 className="font-display text-center text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4 sm:mb-6">
          How it works
        </h2>
        {/* Mobile: equal-width row that always fits */}
        <div className="grid grid-cols-3 gap-2 sm:hidden">
          {[
            { step: '1', title: 'Connect calendar', color: 'from-blue-50 to-cyan-50', border: 'border-blue-100' },
            { step: '2', title: 'Invite friends', color: 'from-violet-50 to-fuchsia-50', border: 'border-violet-100' },
            { step: '3', title: 'Get suggestions', color: 'from-amber-50 to-orange-50', border: 'border-amber-100' },
          ].map((item) => (
            <div
              key={item.step}
              className={`rounded-xl border ${item.border} bg-gradient-to-br ${item.color} p-2 shadow-sm`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-500 text-[9px] font-bold text-white shadow-sm">
                  {item.step}
                </span>
              </div>
              <h3 className="font-display text-[11px] font-bold text-gray-900 leading-tight">{item.title}</h3>
            </div>
          ))}
        </div>
        {/* Desktop: full grid */}
        <div className="hidden sm:grid grid-cols-3 gap-4">
          {[
            {
              step: '1',
              title: 'Connect calendar',
              desc: 'Sign in with Google. We only see free or busy, never event titles or details.',
              color: 'from-blue-50 to-cyan-50',
              border: 'border-blue-100',
            },
            {
              step: '2',
              title: 'Invite friends',
              desc: 'Share a link. When they join, we find mutual free time.',
              color: 'from-violet-50 to-fuchsia-50',
              border: 'border-violet-100',
            },
            {
              step: '3',
              title: 'Get suggestions',
              desc: `AI picks the best times for you. Accept and it's on both calendars.`,
              color: 'from-amber-50 to-orange-50',
              border: 'border-amber-100',
            },
          ].map((item) => (
            <div
              key={item.step}
              className={`rounded-2xl border ${item.border} bg-gradient-to-br ${item.color} p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md`}
            >
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-500 text-xs font-bold text-white shadow-sm">
                  {item.step}
                </span>
              </div>
              <h3 className="font-display text-sm font-bold text-gray-900">{item.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why it matters */}
      <section className="relative z-10 mx-auto max-w-lg px-6 pb-6 sm:pb-10">
        <h2 className="font-display text-center text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3 sm:mb-6">
          Why it matters
        </h2>
        {/* Mobile: compact list */}
        <div className="flex flex-col gap-2 sm:hidden">
          {[
            'Find times that actually work for the whole group',
            "Turn \"let's hang\" into a real plan, no back and forth",
            "Gentle nudge when it's been a while since you hung out",
            "Connect calendars. Slotted finds when everyone's free",
            'Your calendar stays private. We only see free or busy',
          ].map((text, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-lg bg-white/60 px-3 py-2">
              <p className="text-xs text-gray-600">{text}</p>
            </div>
          ))}
        </div>
        {/* Desktop: full accent cards */}
        <div className="hidden sm:flex flex-col gap-3">
          {[
            {
              title: 'Plans, not promises',
              desc: 'Find times that actually work for a friend or the whole group.',
              accent: 'border-l-teal-400',
            },
            {
              title: 'Skip the group text',
              desc: "Turn \"let's hang\" into a real plan without the back and forth.",
              accent: 'border-l-violet-400',
            },
            {
              title: 'Stay in the loop',
              desc: "Get a gentle nudge when it's been a while since you hung out.",
              accent: 'border-l-amber-400',
            },
            {
              title: 'Zero scheduling hassle',
              desc: "Connect your calendars and Slotted finds when everyone's free.",
              accent: 'border-l-pink-400',
            },
            {
              title: 'Your calendar stays private',
              desc: 'We only see free or busy, never details. You control what friends can see.',
              accent: 'border-l-cyan-400',
            },
          ].map((item) => (
            <div
              key={item.title}
              className={`rounded-xl border border-gray-200/60 border-l-[3px] ${item.accent} bg-white/70 px-4 py-3 backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md`}
            >
              <h3 className="font-display text-sm font-bold text-gray-900">{item.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 pb-8 text-center">
        <p className="text-xs text-gray-400">Built for busy people who'd rather hang out than plan to hang out.</p>
        <Link to="/privacy" className="mt-2 inline-block text-xs text-gray-300 hover:text-gray-500 transition-colors">
          Privacy Policy
        </Link>
        <span className="mx-1.5 mt-2 inline-block text-xs text-gray-200">·</span>
        <Link to="/terms" className="mt-2 inline-block text-xs text-gray-300 hover:text-gray-500 transition-colors">
          Terms of Service
        </Link>
      </footer>
    </div>
  );
}

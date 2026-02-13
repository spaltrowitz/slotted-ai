import { useState } from 'react';
import AppShell from '../components/AppShell';
import SocialBattery from '../components/SocialBattery';
import { useAuth } from '../contexts/AuthContext';

type BatteryLevel = 'open' | 'ask_me' | 'recharging';

export default function DashboardPage() {
  const { user } = useAuth();
  const [battery, setBattery] = useState<BatteryLevel>('open');

  const today = new Date();
  const greeting =
    today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const timeEmoji =
    today.getHours() < 12 ? '☀️' : today.getHours() < 18 ? '🌤️' : '🌙';

  return (
    <AppShell>
      {/* Header row with greeting + battery inline */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">
            {greeting}, {user?.displayName?.split(' ')[0]} {timeEmoji}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <SocialBattery level={battery} onChange={setBattery} size="md" />
      </div>

      {/* Bento grid layout — asymmetric, modern */}
      <div className="grid grid-cols-3 gap-4">
        {/* Hero card — spans 2 columns: This Week */}
        <div className="col-span-2 row-span-2 rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="font-display text-sm font-semibold text-gray-900">This Week</h2>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-400">0 events</span>
          </div>
          <div className="flex flex-col items-center justify-center px-6 py-20">
            <div className="animate-float text-5xl">🗓️</div>
            <h3 className="mt-4 font-display text-lg font-bold text-gray-900">
              Your week is wide open
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
              Add some friends and connect your calendar — we'll handle the rest. ✨
            </p>
            <button className="mt-6 rounded-xl gradient-btn px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5">
              Invite a friend
            </button>
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

        {/* Full-width quick action bar */}
        <div className="col-span-3 rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
          <h2 className="font-display text-sm font-semibold text-gray-900 mb-4">Quick Setup</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { emoji: '📅', label: 'Connect Calendar', desc: 'Sync Google Calendar', done: false },
              { emoji: '👋', label: 'Add Friends', desc: 'Invite by email', done: false },
              { emoji: '🔋', label: 'Set Battery', desc: 'Share energy level', done: true },
            ].map((step) => (
              <div
                key={step.label}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                  step.done
                    ? 'border-emerald-200 bg-emerald-50/50'
                    : 'border-gray-200 hover:border-slotted-200 hover:bg-slotted-50/30 cursor-pointer'
                }`}
              >
                <span className="text-xl">{step.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{step.label}</p>
                  <p className="text-xs text-gray-400">{step.desc}</p>
                </div>
                {step.done && (
                  <svg className="h-5 w-5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

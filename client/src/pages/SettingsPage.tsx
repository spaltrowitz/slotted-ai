import { useState } from 'react';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';

export default function SettingsPage() {
  const { user } = useAuth();
  const [travelBuffer, setTravelBuffer] = useState('30');
  const [socialFrequency, setSocialFrequency] = useState('weekly');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // TODO: save settings to API
    console.log('Settings saved:', { travelBuffer, socialFrequency });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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

      {/* 2-column layout for wider content area */}
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
              <div>
                <p className="text-sm font-medium text-gray-900">{user?.displayName}</p>
                <p className="text-xs text-gray-400">{user?.email}</p>
              </div>
            </div>
          </div>

          {/* Calendar */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Calendar</h2>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm">
                  <svg className="h-5 w-5 text-gray-600" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
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
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
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
                  Travel buffer
                </label>
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
        </div>
      </div>
    </AppShell>
  );
}

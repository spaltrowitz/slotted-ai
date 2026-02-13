import { useState } from 'react';
import AppShell from '../components/AppShell';

interface Notification {
  id: string;
  type: 'match' | 'request' | 'accepted' | 'reminder';
  title: string;
  body: string;
  time: string;
  read: boolean;
  actionLabel?: string;
}

// Placeholder data — will be replaced with real API data
const mockNotifications: Notification[] = [];

export default function NotificationsPage() {
  const [notifications] = useState<Notification[]>(mockNotifications);

  const typeConfig: Record<string, { emoji: string; bg: string; border: string }> = {
    match: { emoji: '✨', bg: 'bg-amber-50', border: 'border-amber-100' },
    request: { emoji: '👋', bg: 'bg-violet-50', border: 'border-violet-100' },
    accepted: { emoji: '🎉', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    reminder: { emoji: '⏰', bg: 'bg-blue-50', border: 'border-blue-100' },
  };

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">Inbox</h1>
        <p className="mt-1 text-sm text-gray-500">
          Calendar matches, meetup requests, confirmations, and reminders
        </p>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col items-center justify-center px-6 py-20">
            <div className="animate-float text-5xl mb-2">🔔</div>
            <h3 className="mt-3 font-display text-lg font-bold text-gray-900">
              No notifications yet
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
              Notifications will appear here once you and a friend are connected.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const config = typeConfig[notification.type];
            return (
              <div
                key={notification.id}
                className={`flex items-start gap-4 rounded-2xl border ${
                  notification.read ? 'border-gray-100 bg-white' : `${config.border} ${config.bg}`
                } p-5 shadow-sm transition-all hover:shadow-md`}
              >
                <span className="mt-0.5 text-xl">{config.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`text-sm font-semibold ${notification.read ? 'text-gray-700' : 'text-gray-900'}`}>
                        {notification.title}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-500">{notification.body}</p>
                    </div>
                    <span className="shrink-0 text-xs text-gray-400">{notification.time}</span>
                  </div>
                  {notification.actionLabel && (
                    <button className="mt-3 rounded-lg gradient-btn px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                      {notification.actionLabel}
                    </button>
                  )}
                </div>
                {!notification.read && (
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-slotted-500" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

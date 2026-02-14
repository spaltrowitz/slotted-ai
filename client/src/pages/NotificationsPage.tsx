import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface Notification {
  id: string;
  type: 'friend_accepted' | 'friend_request' | 'meetup_request' | 'meetup_confirmed' | 'meetup_reminder' | 'calendar_match';
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  related_id?: string;
  related_user?: {
    display_name: string;
    photo_url: string | null;
  };
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [rsvpLoading, setRsvpLoading] = useState<string | null>(null);
  const [rsvpDone, setRsvpDone] = useState<Record<string, string>>({});
  const [friendRequestLoading, setFriendRequestLoading] = useState<string | null>(null);
  const [friendRequestDone, setFriendRequestDone] = useState<Record<string, string>>({});

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      // silently fail
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/mark-all-read');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // silently fail
    }
  };

  const handleRsvp = async (notificationId: string, meetupId: string, rsvp: 'accepted' | 'declined' | 'maybe') => {
    setRsvpLoading(notificationId);
    try {
      await api.patch(`/meetups/${meetupId}/rsvp`, { rsvp });
      await api.patch(`/notifications/${notificationId}/read`);
      setRsvpDone((prev) => ({ ...prev, [notificationId]: rsvp }));
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch {
      // silently fail
    } finally {
      setRsvpLoading(null);
    }
  };

  const handleFriendRequest = async (notificationId: string, friendshipId: string, action: 'accept' | 'decline') => {
    setFriendRequestLoading(notificationId);
    try {
      await api.patch(`/friends/${friendshipId}`, { action });
      await api.patch(`/notifications/${notificationId}/read`);
      setFriendRequestDone((prev) => ({ ...prev, [notificationId]: action }));
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch {
      // silently fail
    } finally {
      setFriendRequestLoading(null);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  const typeConfig: Record<string, { emoji: string; bg: string; border: string }> = {
    friend_accepted: { emoji: '🎉', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    friend_request: { emoji: '👋', bg: 'bg-violet-50', border: 'border-violet-100' },
    meetup_request: { emoji: '📅', bg: 'bg-amber-50', border: 'border-amber-100' },
    meetup_confirmed: { emoji: '✅', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    meetup_reminder: { emoji: '⏰', bg: 'bg-blue-50', border: 'border-blue-100' },
    calendar_match: { emoji: '✨', bg: 'bg-amber-50', border: 'border-amber-100' },
  };

  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'requests' | 'reminders'>('all');

  const unreadCount = notifications.filter((n) => !n.read).length;
  const requestTypes = ['friend_request', 'meetup_request'];
  const reminderTypes = ['meetup_reminder', 'calendar_match'];

  const filteredNotifications = notifications.filter((n) => {
    if (activeTab === 'unread') return !n.read;
    if (activeTab === 'requests') return requestTypes.includes(n.type);
    if (activeTab === 'reminders') return reminderTypes.includes(n.type);
    return true;
  });

  const tabs = [
    { key: 'all' as const, label: 'All', count: notifications.length },
    { key: 'unread' as const, label: 'Unread', count: unreadCount },
    { key: 'requests' as const, label: 'Requests', count: notifications.filter((n) => requestTypes.includes(n.type)).length },
    { key: 'reminders' as const, label: 'Reminders', count: notifications.filter((n) => reminderTypes.includes(n.type)).length },
  ];

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">Inbox</h1>
          <p className="mt-1 text-sm text-gray-500">
            Calendar matches, meetup requests, confirmations, and reminders
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1.5 rounded-xl bg-gray-100/80 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                activeTab === tab.key
                  ? tab.key === 'unread' ? 'bg-slotted-100 text-slotted-700' : 'bg-gray-100 text-gray-600'
                  : 'bg-gray-200/60 text-gray-500'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col items-center justify-center px-6 py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slotted-400 border-t-transparent" />
            <p className="mt-3 text-sm text-gray-400">Loading notifications…</p>
          </div>
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col items-center justify-center px-6 py-20">
            <div className="animate-float text-5xl mb-2">{activeTab === 'all' ? '🔔' : activeTab === 'unread' ? '✅' : activeTab === 'requests' ? '👋' : '⏰'}</div>
            <h3 className="mt-3 font-display text-lg font-bold text-gray-900">
              {activeTab === 'all' ? 'No notifications yet' : activeTab === 'unread' ? 'All caught up!' : `No ${activeTab}`}
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
              {activeTab === 'all'
                ? 'Notifications will appear here when a friend accepts your invite, suggests a meetup, or when Slotted finds a great time to hang out.'
                : activeTab === 'unread'
                  ? "You've read all your notifications. Nice!"
                  : `No ${activeTab} to show right now.`}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map((notification) => {
            const config = typeConfig[notification.type] || typeConfig.calendar_match;
            return (
              <div
                key={notification.id}
                onClick={() => !notification.read && markAsRead(notification.id)}
                className={`flex items-start gap-4 rounded-2xl border ${
                  notification.read ? 'border-gray-100 bg-white' : `${config.border} ${config.bg} cursor-pointer`
                } p-5 shadow-sm transition-all hover:shadow-md`}
              >
                {notification.related_user?.photo_url ? (
                  <img
                    src={notification.related_user.photo_url}
                    alt=""
                    className="mt-0.5 h-10 w-10 rounded-full ring-2 ring-white shadow-sm"
                  />
                ) : (
                  <span className="mt-0.5 text-xl">{config.emoji}</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`text-sm font-semibold ${notification.read ? 'text-gray-700' : 'text-gray-900'}`}>
                        {notification.title}
                      </p>
                      <p className="mt-0.5 text-sm text-gray-500">{notification.body}</p>
                    </div>
                    <span className="shrink-0 text-xs text-gray-400">{timeAgo(notification.created_at)}</span>
                  </div>

                  {/* Friend request accept/decline buttons */}
                  {notification.type === 'friend_request' && notification.related_id && (
                    <div className="mt-3">
                      {friendRequestDone[notification.id] ? (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${
                          friendRequestDone[notification.id] === 'accept'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-gray-50 text-gray-600'
                        }`}>
                          {friendRequestDone[notification.id] === 'accept' ? '✅ Accepted' : '❌ Declined'}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFriendRequest(notification.id, notification.related_id!, 'accept'); }}
                            disabled={friendRequestLoading === notification.id}
                            className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-600 shadow-sm disabled:opacity-50"
                          >
                            {friendRequestLoading === notification.id ? '...' : '✅ Accept'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFriendRequest(notification.id, notification.related_id!, 'decline'); }}
                            disabled={friendRequestLoading === notification.id}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Meetup RSVP buttons */}
                  {notification.type === 'meetup_request' && notification.related_id && (
                    <div className="mt-3">
                      {rsvpDone[notification.id] ? (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${
                          rsvpDone[notification.id] === 'accepted'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : rsvpDone[notification.id] === 'maybe'
                              ? 'border-amber-200 bg-amber-50 text-amber-700'
                              : 'border-gray-200 bg-gray-50 text-gray-600'
                        }`}>
                          {rsvpDone[notification.id] === 'accepted' ? '✅ Accepted' : rsvpDone[notification.id] === 'maybe' ? '🤔 Maybe' : 'Not this time'}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRsvp(notification.id, notification.related_id!, 'accepted'); }}
                            disabled={rsvpLoading === notification.id}
                            className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-600 shadow-sm disabled:opacity-50"
                          >
                            {rsvpLoading === notification.id ? '...' : '✅ Accept'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRsvp(notification.id, notification.related_id!, 'maybe'); }}
                            disabled={rsvpLoading === notification.id}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-50"
                          >
                            🤔 Maybe
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRsvp(notification.id, notification.related_id!, 'declined'); }}
                            disabled={rsvpLoading === notification.id}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-50"
                          >
                            Not this time
                          </button>
                        </div>
                      )}
                    </div>
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

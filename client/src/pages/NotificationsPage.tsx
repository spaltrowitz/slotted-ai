import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import AddToCalendarModal from '../components/AddToCalendarModal';
import CounterProposePanel from '../components/CounterProposePanel';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { fetchMeetups, fetchNotifications, queryKeys, type Notification } from '../lib/queries';

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rsvpLoading, setRsvpLoading] = useState<string | null>(null);
  const [rsvpDone, setRsvpDone] = useState<Record<string, string>>({});
  const [calendarModal, setCalendarModal] = useState<{
    meetupId: string;
    title: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const [friendRequestLoading, setFriendRequestLoading] = useState<string | null>(null);
  const [friendRequestDone, setFriendRequestDone] = useState<Record<string, string>>({});
  const [counterProposeFor, setCounterProposeFor] = useState<string | null>(null);
  const [counterProposeActionLoading, setCounterProposeActionLoading] = useState<string | null>(null);
  const [counterProposeActionDone, setCounterProposeActionDone] = useState<Record<string, string>>({});

  const { data: notifications = [], isLoading: loading } = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: fetchNotifications,
    enabled: !!user,
  });

  useEffect(() => {
    if (notifications.length === 0) return;
    const preRsvp: Record<string, string> = {};
    for (const n of notifications) {
      if (n.type === 'meetup_request' && n.my_rsvp && n.my_rsvp !== 'pending') {
        preRsvp[n.id] = n.my_rsvp;
      }
    }
    if (Object.keys(preRsvp).length > 0) {
      setRsvpDone((prev) => ({ ...preRsvp, ...prev }));
    }
  }, [notifications]);

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await api.post('/notifications/mark-all-read');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const dismissNotificationMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/notifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const rsvpMutation = useMutation({
    mutationFn: async ({ meetupId, rsvp }: { meetupId: string; rsvp: 'accepted' | 'declined' | 'maybe' }) => {
      const { data } = await api.patch(`/meetups/${meetupId}/rsvp`, { rsvp });
      return data as { quotaWarning?: { message: string } };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meetups });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const friendRequestMutation = useMutation({
    mutationFn: async ({ friendshipId, action }: { friendshipId: string; action: 'accept' | 'decline' }) => {
      await api.patch(`/friends/${friendshipId}`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const counterProposeMutation = useMutation({
    mutationFn: async ({ meetupId, action }: { meetupId: string; action: 'update_time' | 'keep_original' }) => {
      if (action === 'update_time') {
        await api.patch(`/meetups/${meetupId}/rsvp`, { rsvp: 'accepted' });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meetups });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const markAsRead = async (id: string) => {
    const previousNotifications = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
    queryClient.setQueryData(
      queryKeys.notifications,
      previousNotifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    try {
      await markAsReadMutation.mutateAsync(id);
    } catch {
      queryClient.setQueryData(queryKeys.notifications, previousNotifications);
    }
  };

  const markAllRead = async () => {
    const previousNotifications = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
    queryClient.setQueryData(
      queryKeys.notifications,
      previousNotifications.map((n) => ({ ...n, read: true })),
    );
    try {
      await markAllReadMutation.mutateAsync();
    } catch {
      queryClient.setQueryData(queryKeys.notifications, previousNotifications);
    }
  };

  const dismissNotification = async (id: string) => {
    const previousNotifications = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
    queryClient.setQueryData(
      queryKeys.notifications,
      previousNotifications.filter((n) => n.id !== id),
    );
    try {
      await dismissNotificationMutation.mutateAsync(id);
    } catch {
      queryClient.setQueryData(queryKeys.notifications, previousNotifications);
    }
  };

  const handleRsvp = async (notificationId: string, meetupId: string, rsvp: 'accepted' | 'declined' | 'maybe') => {
    setRsvpLoading(notificationId);
    try {
      const data = await rsvpMutation.mutateAsync({ meetupId, rsvp });
      // Check for quota warning before finalizing
      if (data.quotaWarning && rsvp === 'accepted') {
        const proceed = window.confirm(data.quotaWarning.message);
        if (!proceed) {
          // Undo the RSVP
          await rsvpMutation.mutateAsync({ meetupId, rsvp: 'declined' });
          setRsvpLoading(null);
          return;
        }
      }
      await markAsReadMutation.mutateAsync(notificationId);
      setRsvpDone((prev) => ({ ...prev, [notificationId]: rsvp }));
      const previousNotifications = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
      queryClient.setQueryData(
        queryKeys.notifications,
        previousNotifications.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
      );

      // If accepted, prompt to add to calendar
      if (rsvp === 'accepted') {
        try {
          const meetups = await queryClient.fetchQuery({
            queryKey: queryKeys.meetups,
            queryFn: fetchMeetups,
          });
          const meetup = meetups.find((m) => m.id === meetupId);
          if (meetup) {
            setCalendarModal({
              meetupId: meetup.id,
              title: meetup.title || 'Hangout',
              startTime: meetup.start_time,
              endTime: meetup.end_time,
            });
          }
        } catch {
          // Can't fetch meetup details — skip calendar prompt
        }
      }
    } catch {
      // silently fail
    } finally {
      setRsvpLoading(null);
    }
  };

  const handleFriendRequest = async (notificationId: string, friendshipId: string, action: 'accept' | 'decline') => {
    setFriendRequestLoading(notificationId);
    try {
      await friendRequestMutation.mutateAsync({ friendshipId, action });
      await markAsReadMutation.mutateAsync(notificationId);
      setFriendRequestDone((prev) => ({ ...prev, [notificationId]: action }));
      const previousNotifications = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
      queryClient.setQueryData(
        queryKeys.notifications,
        previousNotifications.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
      );
    } catch {
      // silently fail
    } finally {
      setFriendRequestLoading(null);
    }
  };

  const handleCounterProposeAction = async (notificationId: string, meetupId: string, action: 'update_time' | 'keep_original') => {
    setCounterProposeActionLoading(notificationId);
    try {
      await counterProposeMutation.mutateAsync({ meetupId, action });
      await markAsReadMutation.mutateAsync(notificationId);
      setCounterProposeActionDone((prev) => ({ ...prev, [notificationId]: action }));
      const previousNotifications = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
      queryClient.setQueryData(
        queryKeys.notifications,
        previousNotifications.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
      );
    } catch {
      // silently fail
    } finally {
      setCounterProposeActionLoading(null);
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
    friend_accepted: { emoji: '', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    friend_request: { emoji: '', bg: 'bg-violet-50', border: 'border-violet-100' },
    meetup_request: { emoji: '', bg: 'bg-amber-50', border: 'border-amber-100' },
    meetup_confirmed: { emoji: '✅', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    meetup_reminder: { emoji: '⏳', bg: 'bg-blue-50', border: 'border-blue-100' },
    calendar_match: { emoji: '', bg: 'bg-amber-50', border: 'border-amber-100' },
    event_shared: { emoji: '', bg: 'bg-purple-50', border: 'border-purple-100' },
    meetup_rsvp_changed: { emoji: '', bg: 'bg-sky-50', border: 'border-sky-100' },
    meetup_time_changed: { emoji: '', bg: 'bg-indigo-50', border: 'border-indigo-100' },
    meetup_counter_propose: { emoji: '', bg: 'bg-violet-50', border: 'border-violet-100' },
  };

  /** Parse a shared event from the notification body if it starts with [EVENT_SHARE] */
  const parseSharedEvent = (body: string) => {
    if (!body.startsWith('[EVENT_SHARE]')) return null;
    try {
      return JSON.parse(body.replace('[EVENT_SHARE]', ''));
    } catch { return null; }
  };

  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'requests' | 'reminders'>('all');

  const unreadCount = notifications.filter((n) => !n.read).length;
  const requestTypes = ['friend_request', 'meetup_request', 'meetup_counter_propose'];
  const reminderTypes = ['meetup_reminder', 'calendar_match', 'meetup_rsvp_changed', 'meetup_time_changed'];
  // event_shared notifications are shown in all tabs

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

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      void markAsRead(notification.id);
    }

    const isSharedEvent = notification.body.startsWith('[EVENT_SHARE]');
    const isFriendJoinedNotification = notification.type === 'friend_accepted';

    if (notification.type === 'calendar_match' && notification.related_user_id && !isSharedEvent) {
      navigate(`/friends?findTimes=${encodeURIComponent(notification.related_user_id)}`);
      return;
    }

    if (isFriendJoinedNotification) {
      if (notification.related_user_id) {
        navigate(`/friends?findTimes=${encodeURIComponent(notification.related_user_id)}`);
      } else {
        navigate('/friends');
      }
      return;
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">Inbox</h1>
          <p className="mt-1 text-sm text-gray-500">
            Calendar matches, meetup requests, confirmations, and reminders
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 rounded-xl bg-gray-100/80 p-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold whitespace-nowrap transition-all ${
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
            <div className="animate-float text-4xl sm:text-5xl mb-2">{activeTab === 'all' ? '' : activeTab === 'unread' ? '✅' : activeTab === 'requests' ? '' : '⏳'}</div>
            <h3 className="mt-3 font-display text-lg font-bold text-gray-900">
              {activeTab === 'all' ? 'No notifications yet' : activeTab === 'unread' ? 'All caught up!' : `No ${activeTab}`}
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
              {activeTab === 'all'
                ? 'Notifications will appear here when a friend accepts your invite, suggests a meetup, or when Slotted.ai finds a great time to hang out.'
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
                onClick={() => handleNotificationClick(notification)}
                className={`flex items-start gap-2.5 rounded-xl border ${
                  notification.read ? 'border-gray-100 bg-white' : `${config.border} ${config.bg} cursor-pointer`
                } px-3 py-2.5 shadow-sm transition-all hover:shadow-md`}
              >
                {notification.related_user?.photo_url ? (
                  <img
                    src={notification.related_user.photo_url}
                    alt=""
                    className="mt-0.5 h-8 w-8 rounded-full ring-2 ring-white shadow-sm"
                    loading="lazy"
                  />
                ) : (
                  config.emoji ? <span className="mt-0.5 text-base">{config.emoji}</span> : null
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className={`text-xs font-semibold ${notification.read ? 'text-gray-700' : 'text-gray-900'}`}>
                        {notification.title}
                      </p>
                      {/* Shared event card rendering */}
                      {(() => {
                        const sharedEvent = parseSharedEvent(notification.body);
                        if (sharedEvent) {
                          return (
                            <div className="mt-1.5">
                              <a
                                href={sharedEvent.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2.5 rounded-lg border border-gray-200 bg-white p-2 transition-all hover:shadow-md hover:border-slotted-200"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {sharedEvent.imageUrl ? (
                                  <img src={sharedEvent.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0 shadow-sm" loading="lazy" />
                                ) : (
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-100 to-pink-100 text-base">
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-gray-900 truncate">{sharedEvent.title}</p>
                                  <p className="text-[10px] text-gray-500 truncate">
                                    {sharedEvent.datetimeLocal ? new Date(sharedEvent.datetimeLocal).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                                    {sharedEvent.venue ? ` · ${sharedEvent.venue}` : ''}
                                  </p>
                                </div>
                                <span className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-slotted-600 hover:bg-slotted-50 transition-colors">
                                </span>
                              </a>
                              {sharedEvent.senderMessage && (
                                <p className="mt-1 text-[11px] text-gray-500 italic">"{sharedEvent.senderMessage}"</p>
                              )}
                            </div>
                          );
                        }
                        return (
                          <p className="mt-0.5 text-[11px] text-gray-500 leading-snug">
                            <NotificationBody text={notification.body} />
                          </p>
                        );
                      })()}
                    </div>
                    <span className="shrink-0 text-[10px] text-gray-400">{timeAgo(notification.created_at)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismissNotification(notification.id); }}
                      className="shrink-0 rounded-full p-1 text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-all ml-1"
                      title="Dismiss"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Friend request accept/decline buttons */}
                  {notification.type === 'friend_request' && notification.related_id && (
                    <div className="mt-2">
                      {friendRequestDone[notification.id] ? (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                          friendRequestDone[notification.id] === 'accept'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-gray-50 text-gray-600'
                        }`}>
                          {friendRequestDone[notification.id] === 'accept' ? '✅ Accepted' : 'Declined'}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFriendRequest(notification.id, notification.related_id!, 'accept'); }}
                            disabled={friendRequestLoading === notification.id}
                            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-emerald-600 shadow-sm disabled:opacity-50"
                          >
                            {friendRequestLoading === notification.id ? '...' : '✅ Accept'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFriendRequest(notification.id, notification.related_id!, 'decline'); }}
                            disabled={friendRequestLoading === notification.id}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Meetup RSVP buttons */}
                  {notification.type === 'meetup_request' && notification.related_id && (
                    <div className="mt-2">
                      {rsvpDone[notification.id] ? (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                          rsvpDone[notification.id] === 'accepted'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : rsvpDone[notification.id] === 'maybe'
                              ? 'border-amber-200 bg-amber-50 text-amber-700'
                              : rsvpDone[notification.id] === 'counter_proposed'
                                ? 'border-blue-200 bg-blue-50 text-blue-700'
                                : 'border-gray-200 bg-gray-50 text-gray-600'
                        }`}>
                          {rsvpDone[notification.id] === 'accepted' ? '✅ Accepted' : rsvpDone[notification.id] === 'maybe' ? 'Maybe' : rsvpDone[notification.id] === 'counter_proposed' ? 'Suggested new time' : 'Not this time'}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRsvp(notification.id, notification.related_id!, 'accepted'); }}
                            disabled={rsvpLoading === notification.id}
                            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-emerald-600 shadow-sm disabled:opacity-50"
                          >
                            {rsvpLoading === notification.id ? '...' : '✅ Accept'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRsvp(notification.id, notification.related_id!, 'maybe'); }}
                            disabled={rsvpLoading === notification.id}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-50"
                          >
                            Maybe
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (notification.related_user_id) {
                                setCounterProposeFor(counterProposeFor === notification.id ? null : notification.id);
                              } else {
                                handleRsvp(notification.id, notification.related_id!, 'declined');
                              }
                            }}
                            disabled={rsvpLoading === notification.id}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-50"
                          >
                            Not this time
                          </button>
                        </div>
                      )}

                      {/* Counter-propose panel */}
                      {counterProposeFor === notification.id && notification.related_id && notification.related_user_id && (
                        <CounterProposePanel
                          meetupId={notification.related_id}
                          friendId={notification.related_user_id}
                          friendName={notification.related_user?.display_name || 'your friend'}
                          originalTime={notification.body}
                          onCounterProposed={() => {
                            setCounterProposeFor(null);
                            setRsvpDone((prev) => ({ ...prev, [notification.id]: 'counter_proposed' }));
                            markAsRead(notification.id);
                          }}
                          onJustDecline={() => {
                            setCounterProposeFor(null);
                            handleRsvp(notification.id, notification.related_id!, 'declined');
                          }}
                          onCancel={() => setCounterProposeFor(null)}
                        />
                      )}
                    </div>
                  )}

                  {/* Add to calendar button for confirmed meetups */}
                  {notification.type === 'meetup_confirmed' && notification.related_id && (
                    <div className="mt-3">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const meetups = await queryClient.fetchQuery({
                              queryKey: queryKeys.meetups,
                              queryFn: fetchMeetups,
                            });
                            const meetup = meetups.find((m) => m.id === notification.related_id);
                            if (meetup) {
                              setCalendarModal({
                                meetupId: meetup.id,
                                title: meetup.title || 'Hangout',
                                startTime: meetup.start_time,
                                endTime: meetup.end_time,
                              });
                            }
                          } catch { /* silent */ }
                        }}
                        className="rounded-lg border border-slotted-200 bg-slotted-50 px-4 py-1.5 text-xs font-semibold text-slotted-700 transition-all hover:bg-slotted-100 shadow-sm"
                      >
                        Add to calendar
                      </button>
                    </div>
                  )}

                  {/* View meetup link for calendar-sync notifications (informational only) */}
                  {(notification.type === 'meetup_rsvp_changed' || notification.type === 'meetup_time_changed') && notification.related_id && (
                    <div className="mt-3">
                      <Link
                        to="/dashboard"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slotted-200 bg-slotted-50 px-4 py-1.5 text-xs font-semibold text-slotted-700 transition-all hover:bg-slotted-100 shadow-sm"
                      >
                        View meetup
                      </Link>
                    </div>
                  )}

                  {/* Counter-propose action buttons */}
                  {notification.type === 'meetup_counter_propose' && notification.related_id && (
                    <div className="mt-3">
                      {counterProposeActionDone[notification.id] ? (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${
                          counterProposeActionDone[notification.id] === 'update_time'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-gray-50 text-gray-600'
                        }`}>
                          {counterProposeActionDone[notification.id] === 'update_time' ? '✅ Time updated' : 'Kept original time'}
                        </span>
                      ) : notification.read ? (
                        <Link
                          to="/dashboard"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slotted-200 bg-slotted-50 px-4 py-1.5 text-xs font-semibold text-slotted-700 transition-all hover:bg-slotted-100 shadow-sm"
                        >
                          View meetup
                        </Link>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCounterProposeAction(notification.id, notification.related_id!, 'update_time'); }}
                            disabled={counterProposeActionLoading === notification.id}
                            className="rounded-lg bg-violet-500 px-4 py-1.5 text-xs font-semibold text-white transition-all hover:bg-violet-600 shadow-sm disabled:opacity-50"
                          >
                            {counterProposeActionLoading === notification.id ? '...' : 'Update time'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCounterProposeAction(notification.id, notification.related_id!, 'keep_original'); }}
                            disabled={counterProposeActionLoading === notification.id}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-50"
                          >
                            Keep original
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Add to calendar button after accepting RSVP */}
                  {notification.type === 'meetup_request' && rsvpDone[notification.id] === 'accepted' && notification.related_id && (
                    <div className="mt-2">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const meetups = await queryClient.fetchQuery({
                              queryKey: queryKeys.meetups,
                              queryFn: fetchMeetups,
                            });
                            const meetup = meetups.find((m) => m.id === notification.related_id);
                            if (meetup) {
                              setCalendarModal({
                                meetupId: meetup.id,
                                title: meetup.title || 'Hangout',
                                startTime: meetup.start_time,
                                endTime: meetup.end_time,
                              });
                            }
                          } catch { /* silent */ }
                        }}
                        className="rounded-lg border border-slotted-200 bg-slotted-50 px-4 py-1.5 text-xs font-semibold text-slotted-700 transition-all hover:bg-slotted-100 shadow-sm"
                      >
                        Add to calendar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add to Calendar modal */}
      {calendarModal && (
        <AddToCalendarModal
          meetupId={calendarModal.meetupId}
          meetupTitle={calendarModal.title}
          startTime={calendarModal.startTime}
          endTime={calendarModal.endTime}
          onClose={() => setCalendarModal(null)}
        />
      )}
    </AppShell>
  );
}

/** Renders notification body text with clickable links for known routes */
function NotificationBody({ text }: { text: string }) {
  const linkMap: [RegExp, string][] = [
    [/Friends tab/gi, '/friends'],
    [/Settings/gi, '/settings'],
    [/Events tab/gi, '/events'],
    [/Dashboard/gi, '/'],
  ];

  const parts: (string | React.ReactElement)[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let earliest: { index: number; length: number; to: string; match: string } | null = null;

    for (const [regex, to] of linkMap) {
      regex.lastIndex = 0;
      const m = regex.exec(remaining);
      if (m && (!earliest || m.index < earliest.index)) {
        earliest = { index: m.index, length: m[0].length, to, match: m[0] };
      }
    }

    if (!earliest) {
      parts.push(remaining);
      break;
    }

    if (earliest.index > 0) {
      parts.push(remaining.slice(0, earliest.index));
    }

    parts.push(
      <Link
        key={key++}
        to={earliest.to}
        className="font-semibold text-slotted-600 underline underline-offset-2 hover:text-slotted-700"
        onClick={(e) => e.stopPropagation()}
      >
        {earliest.match}
      </Link>
    );

    remaining = remaining.slice(earliest.index + earliest.length);
  }

  return <>{parts}</>;
}

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { fetchMeetups, fetchNotifications, queryKeys, type Notification } from '../lib/queries';
import AddToCalendarModal from './AddToCalendarModal';
import CounterProposePanel from './CounterProposePanel';

interface NotificationDropdownProps {
  open: boolean;
  onClose: () => void;
}

export default function NotificationDropdown({ open, onClose }: NotificationDropdownProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

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

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (backdropRef.current && e.target === backdropRef.current) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Swipe-down to close on mobile
  const touchStartY = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;

    const onTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0]?.clientY ?? null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (touchStartY.current === null) return;
      const endY = e.changedTouches[0]?.clientY ?? touchStartY.current;
      if (endY - touchStartY.current > 80) onClose();
      touchStartY.current = null;
    };

    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      sheet.removeEventListener('touchstart', onTouchStart);
      sheet.removeEventListener('touchend', onTouchEnd);
    };
  }, [open, onClose]);

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => { await api.patch(`/notifications/${id}/read`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.notifications }); },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => { await api.post('/notifications/mark-all-read'); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.notifications }); },
  });

  const dismissNotificationMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/notifications/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.notifications }); },
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
    const prev = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
    queryClient.setQueryData(queryKeys.notifications, prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try { await markAsReadMutation.mutateAsync(id); } catch { queryClient.setQueryData(queryKeys.notifications, prev); }
  };

  const markAllRead = async () => {
    const prev = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
    queryClient.setQueryData(queryKeys.notifications, prev.map((n) => ({ ...n, read: true })));
    try { await markAllReadMutation.mutateAsync(); } catch { queryClient.setQueryData(queryKeys.notifications, prev); }
  };

  const dismissNotification = async (id: string) => {
    const prev = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
    queryClient.setQueryData(queryKeys.notifications, prev.filter((n) => n.id !== id));
    try { await dismissNotificationMutation.mutateAsync(id); } catch { queryClient.setQueryData(queryKeys.notifications, prev); }
  };

  const handleRsvp = async (notificationId: string, meetupId: string, rsvp: 'accepted' | 'declined' | 'maybe') => {
    setRsvpLoading(notificationId);
    try {
      const data = await rsvpMutation.mutateAsync({ meetupId, rsvp });
      if (data.quotaWarning && rsvp === 'accepted') {
        const proceed = window.confirm(data.quotaWarning.message);
        if (!proceed) {
          await rsvpMutation.mutateAsync({ meetupId, rsvp: 'declined' });
          setRsvpLoading(null);
          return;
        }
      }
      await markAsReadMutation.mutateAsync(notificationId);
      setRsvpDone((prev) => ({ ...prev, [notificationId]: rsvp }));
      const prev = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
      queryClient.setQueryData(queryKeys.notifications, prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));

      if (rsvp === 'accepted') {
        try {
          const meetups = await queryClient.fetchQuery({ queryKey: queryKeys.meetups, queryFn: fetchMeetups });
          const meetup = meetups.find((m) => m.id === meetupId);
          if (meetup) {
            setCalendarModal({ meetupId: meetup.id, title: meetup.title || 'Hangout', startTime: meetup.start_time, endTime: meetup.end_time });
          }
        } catch { /* skip calendar prompt */ }
      }
    } catch { /* silently fail */ } finally { setRsvpLoading(null); }
  };

  const handleFriendRequest = async (notificationId: string, friendshipId: string, action: 'accept' | 'decline') => {
    setFriendRequestLoading(notificationId);
    try {
      await friendRequestMutation.mutateAsync({ friendshipId, action });
      await markAsReadMutation.mutateAsync(notificationId);
      setFriendRequestDone((prev) => ({ ...prev, [notificationId]: action }));
      const prev = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
      queryClient.setQueryData(queryKeys.notifications, prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
    } catch { /* silently fail */ } finally { setFriendRequestLoading(null); }
  };

  const handleCounterProposeAction = async (notificationId: string, meetupId: string, action: 'update_time' | 'keep_original') => {
    setCounterProposeActionLoading(notificationId);
    try {
      await counterProposeMutation.mutateAsync({ meetupId, action });
      await markAsReadMutation.mutateAsync(notificationId);
      setCounterProposeActionDone((prev) => ({ ...prev, [notificationId]: action }));
      const prev = queryClient.getQueryData<Notification[]>(queryKeys.notifications) ?? notifications;
      queryClient.setQueryData(queryKeys.notifications, prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
    } catch { /* silently fail */ } finally { setCounterProposeActionLoading(null); }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) void markAsRead(notification.id);

    const isSharedEvent = notification.body.startsWith('[EVENT_SHARE]');
    const isFriendJoined = notification.type === 'friend_accepted';

    if (notification.type === 'calendar_match' && notification.related_user_id && !isSharedEvent) {
      onClose();
      navigate(`/friends?findTimes=${encodeURIComponent(notification.related_user_id)}`);
      return;
    }
    if (isFriendJoined) {
      onClose();
      navigate(notification.related_user_id ? `/friends?findTimes=${encodeURIComponent(notification.related_user_id)}` : '/friends');
      return;
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

  const parseSharedEvent = (body: string) => {
    if (!body.startsWith('[EVENT_SHARE]')) return null;
    try { return JSON.parse(body.replace('[EVENT_SHARE]', '')); } catch { return null; }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div ref={backdropRef} className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-[2px]" />

      {/* Sheet — bottom on mobile, dropdown on desktop */}
      <div
        ref={sheetRef}
        className="fixed z-[70] md:absolute md:right-0 md:top-full md:mt-2 inset-x-0 bottom-0 md:inset-x-auto md:bottom-auto md:w-[420px] max-h-[60vh] flex flex-col rounded-t-2xl md:rounded-2xl border border-gray-200/80 bg-white shadow-2xl overflow-hidden animate-slide-up md:animate-none"
        style={{ animationDuration: '200ms' }}
      >
        {/* Drag handle — mobile only */}
        <div className="flex justify-center pt-2 pb-1 md:hidden">
          <div className="h-1 w-8 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <h3 className="font-display text-sm font-bold text-gray-900">Notifications</h3>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-slotted-600 hover:bg-slotted-50 transition-colors"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="flex flex-col items-center justify-center px-6 py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slotted-400 border-t-transparent" />
              <p className="mt-2 text-xs text-gray-400">Loading…</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12">
              <div className="text-3xl mb-1"></div>
              <h3 className="font-display text-sm font-bold text-gray-900">No notifications yet</h3>
              <p className="mt-1 text-xs text-gray-400 text-center max-w-xs">
                Notifications will appear here when friends accept invites, suggest meetups, or when Slotted finds a great time.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {notifications.map((notification) => {
                const config = typeConfig[notification.type] || typeConfig.calendar_match;
                return (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`flex items-start gap-2.5 px-4 py-3 transition-colors ${
                      notification.read ? 'bg-white' : `${config.bg} cursor-pointer`
                    } hover:bg-gray-50/50`}
                  >
                    {notification.related_user?.photo_url ? (
                      <img src={notification.related_user.photo_url} alt="" className="mt-0.5 h-7 w-7 rounded-full ring-2 ring-white shadow-sm" loading="lazy" />
                    ) : (
                      config.emoji ? <span className="mt-0.5 text-sm">{config.emoji}</span> : null
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`text-xs font-semibold truncate ${notification.read ? 'text-gray-700' : 'text-gray-900'}`}>
                            {notification.title}
                          </p>
                          {(() => {
                            const sharedEvent = parseSharedEvent(notification.body);
                            if (sharedEvent) {
                              return (
                                <a
                                  href={sharedEvent.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-1.5 transition-all hover:shadow-sm"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {sharedEvent.imageUrl ? (
                                    <img src={sharedEvent.imageUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" loading="lazy" />
                                  ) : (
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gradient-to-br from-purple-100 to-pink-100 text-sm"></div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-semibold text-gray-900 truncate">{sharedEvent.title}</p>
                                    <p className="text-[9px] text-gray-500 truncate">
                                      {sharedEvent.datetimeLocal ? new Date(sharedEvent.datetimeLocal).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                                      {sharedEvent.venue ? ` · ${sharedEvent.venue}` : ''}
                                    </p>
                                  </div>
                                </a>
                              );
                            }
                            return (
                              <p className="mt-0.5 text-[11px] text-gray-500 leading-snug line-clamp-2">
                                {notification.body}
                              </p>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-gray-400">{timeAgo(notification.created_at)}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); dismissNotification(notification.id); }}
                            className="rounded-full p-0.5 text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-all"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Friend request actions */}
                      {notification.type === 'friend_request' && notification.related_id && (
                        <div className="mt-1.5">
                          {friendRequestDone[notification.id] ? (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                              friendRequestDone[notification.id] === 'accept'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-gray-200 bg-gray-50 text-gray-600'
                            }`}>
                              {friendRequestDone[notification.id] === 'accept' ? '✅ Accepted' : 'Not this time'}
                            </span>
                          ) : (
                            <div className="flex gap-1.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleFriendRequest(notification.id, notification.related_id!, 'accept'); }}
                                disabled={friendRequestLoading === notification.id}
                                className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-600 shadow-sm disabled:opacity-50"
                              >
                                {friendRequestLoading === notification.id ? '...' : '✅ Accept'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleFriendRequest(notification.id, notification.related_id!, 'decline'); }}
                                disabled={friendRequestLoading === notification.id}
                                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                              >
                                Not this time
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Meetup RSVP actions */}
                      {notification.type === 'meetup_request' && notification.related_id && (
                        <div className="mt-1.5">
                          {rsvpDone[notification.id] ? (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
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
                                className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-600 shadow-sm disabled:opacity-50"
                              >
                                {rsvpLoading === notification.id ? '...' : '✅ Accept'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRsvp(notification.id, notification.related_id!, 'maybe'); }}
                                disabled={rsvpLoading === notification.id}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
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
                                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                              >
                                Not this time
                              </button>
                            </div>
                          )}

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

                      {/* Add to calendar for confirmed meetups */}
                      {notification.type === 'meetup_confirmed' && notification.related_id && (
                        <div className="mt-1.5">
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const meetups = await queryClient.fetchQuery({ queryKey: queryKeys.meetups, queryFn: fetchMeetups });
                                const meetup = meetups.find((m) => m.id === notification.related_id);
                                if (meetup) setCalendarModal({ meetupId: meetup.id, title: meetup.title || 'Hangout', startTime: meetup.start_time, endTime: meetup.end_time });
                              } catch { /* silent */ }
                            }}
                            className="rounded-lg border border-slotted-200 bg-slotted-50 px-3 py-1 text-[10px] font-semibold text-slotted-700 hover:bg-slotted-100 shadow-sm"
                          >
                            Add to calendar
                          </button>
                        </div>
                      )}

                      {/* View meetup link for sync notifications */}
                      {(notification.type === 'meetup_rsvp_changed' || notification.type === 'meetup_time_changed') && notification.related_id && (
                        <div className="mt-1.5">
                          <Link
                            to="/dashboard"
                            onClick={(e) => { e.stopPropagation(); onClose(); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slotted-200 bg-slotted-50 px-3 py-1 text-[10px] font-semibold text-slotted-700 hover:bg-slotted-100 shadow-sm"
                          >
                            View meetup
                          </Link>
                        </div>
                      )}

                      {/* Counter-propose action buttons */}
                      {notification.type === 'meetup_counter_propose' && notification.related_id && (
                        <div className="mt-1.5">
                          {counterProposeActionDone[notification.id] ? (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                              counterProposeActionDone[notification.id] === 'update_time'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-gray-200 bg-gray-50 text-gray-600'
                            }`}>
                              {counterProposeActionDone[notification.id] === 'update_time' ? '✅ Time updated' : 'Kept original time'}
                            </span>
                          ) : notification.read ? (
                            <Link
                              to="/dashboard"
                              onClick={(e) => { e.stopPropagation(); onClose(); }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slotted-200 bg-slotted-50 px-3 py-1 text-[10px] font-semibold text-slotted-700 hover:bg-slotted-100 shadow-sm"
                            >
                              View meetup
                            </Link>
                          ) : (
                            <div className="flex gap-1.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCounterProposeAction(notification.id, notification.related_id!, 'update_time'); }}
                                disabled={counterProposeActionLoading === notification.id}
                                className="rounded-lg bg-violet-500 px-3 py-1 text-[10px] font-semibold text-white hover:bg-violet-600 shadow-sm disabled:opacity-50"
                              >
                                {counterProposeActionLoading === notification.id ? '...' : 'Update time'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCounterProposeAction(notification.id, notification.related_id!, 'keep_original'); }}
                                disabled={counterProposeActionLoading === notification.id}
                                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                              >
                                Keep original
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Calendar button after accepting RSVP */}
                      {notification.type === 'meetup_request' && rsvpDone[notification.id] === 'accepted' && notification.related_id && (
                        <div className="mt-1.5">
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const meetups = await queryClient.fetchQuery({ queryKey: queryKeys.meetups, queryFn: fetchMeetups });
                                const meetup = meetups.find((m) => m.id === notification.related_id);
                                if (meetup) setCalendarModal({ meetupId: meetup.id, title: meetup.title || 'Hangout', startTime: meetup.start_time, endTime: meetup.end_time });
                              } catch { /* silent */ }
                            }}
                            className="rounded-lg border border-slotted-200 bg-slotted-50 px-3 py-1 text-[10px] font-semibold text-slotted-700 hover:bg-slotted-100 shadow-sm"
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
        </div>
      </div>

      {/* Calendar modal */}
      {calendarModal && (
        <AddToCalendarModal
          meetupId={calendarModal.meetupId}
          meetupTitle={calendarModal.title}
          startTime={calendarModal.startTime}
          endTime={calendarModal.endTime}
          onClose={() => setCalendarModal(null)}
        />
      )}
    </>
  );
}

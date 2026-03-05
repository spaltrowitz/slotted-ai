import api from './api';

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  activityFeed: ['activity-feed'] as const,
  meetups: ['meetups'] as const,
  friends: ['friends'] as const,

  notifications: ['notifications'] as const,
  settings: ['settings'] as const,
  events: {
    suggestions: ['events', 'suggestions'] as const,
    saved: ['events', 'saved'] as const,
    discover: (params: EventDiscoverParams) => ['events', 'discover', params] as const,
  },
  calendarEvents: (days: number, connected: boolean) => ['calendar', 'events', days, connected ? 'connected' : 'manual'] as const,
  calendarStatus: ['calendar', 'status'] as const,
};

export interface ActivityFeedItem {
  type: 'overdue_friends' | 'recent_activity' | 'free_weekend';
  priority: number;
  friendId: string;
  friendName: string;
  friendPhoto?: string;
  message: string;
  timestamp?: string;
  activityType?: string;
}

export interface FriendToSee {
  id: string;
  displayName: string;
  photoUrl: string | null;
  socialBattery: string;
  lastHangout: string | null;
  neighborhood: string | null;
  timezone: string | null;
  friendshipType: string;
}

export interface MeetupParticipant {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  rsvp: string;
}

export interface Meetup {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  created_by: string;
  participants: MeetupParticipant[];
  myRsvp: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  source: 'google' | 'apple';
  calendarName: string;
  color: string | null;
  status?: string;
  myRsvp?: string;
  participants?: MeetupParticipant[];
}

export interface FriendRecord {
  friendshipId: string;
  status: string;
  invitedBy: string;
  friendshipType?: string;
  lastHangoutDate?: string;
  daysSinceLastHangout?: number;
  avgCadenceDays?: number;
  totalHangouts?: number;
  friend: {
    id: string;
    displayName: string;
    email: string;
    photoUrl?: string;
    socialBattery?: string;
    calendarConnected?: boolean;
    eventInterests?: string[];
  };
}


export interface UserSettings {
  social_frequency?: string;
  preferred_times?: string[];
  travel_buffer_min?: number;
  planning_style?: string;
  recharging_days?: number[];
  share_hangouts?: boolean;
  call_windows?: { day: number; start: string; end: string; label: string }[];
  video_platforms?: string[];
  neighborhood?: string;
  work_neighborhood?: string;
  office_days?: number[];
  office_schedule_varies?: boolean;
  social_goal?: string;
  preferred_duration?: string;
  preferred_call_duration?: string;
  event_interests?: string[];
  event_city?: string;
  display_name?: string;
}

export interface EventSuggestion {
  id: string;
  title: string;
  reason?: string;
  datetimeLocal?: string;
  venue?: string;
  imageUrl?: string;
  url?: string;
  matchingFriends?: { id: string; name: string; photo?: string | null }[];
}

export interface EventResult {
  id: string;
  source: string;
  sources?: string[];
  title: string;
  type: string;
  venue: string;
  city: string;
  datetime: string;
  datetimeLocal: string;
  url: string;
  urls?: { source: string; url: string }[];
  imageUrl?: string;
  priceMin?: number;
  priceMax?: number;
  performers?: string[];
}

export interface SavedEvent {
  id?: string;
  external_id?: string;
  source?: string;
  title: string;
  event_type?: string;
  venue?: string;
  city?: string;
  datetime_utc?: string;
  datetime_local?: string;
  url?: string;
  image_url?: string;
  price_min?: number | string;
  price_max?: number | string;
  performers?: string[];
}

export interface Notification {
  id: string;
  type: 'friend_accepted' | 'friend_request' | 'meetup_request' | 'meetup_confirmed' | 'meetup_reminder' | 'calendar_match' | 'meetup_rsvp_changed' | 'meetup_time_changed' | 'meetup_counter_propose';
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  related_id?: string;
  related_user_id?: string;
  related_user?: {
    display_name: string;
    photo_url: string | null;
  };
  my_rsvp?: string;
}

export interface EventDiscoverParams {
  city?: string;
  perPage?: number;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const fetchDashboard = async (): Promise<FriendToSee[]> => {
  const { data } = await api.get<{ friendsToSee?: FriendToSee[] }>('/dashboard');
  return data.friendsToSee ?? [];
};

export const fetchActivityFeed = async (): Promise<ActivityFeedItem[]> => {
  const { data } = await api.get<{ activities?: ActivityFeedItem[] }>('/activity-feed');
  return data.activities ?? [];
};

export const fetchMeetups = async (): Promise<Meetup[]> => {
  const { data } = await api.get<{ meetups?: Meetup[] }>('/meetups');
  return data.meetups ?? [];
};

export const fetchFriends = async (): Promise<FriendRecord[]> => {
  const { data } = await api.get<{ friends?: FriendRecord[] }>('/friends');
  return data.friends ?? [];
};


export const fetchEventSuggestions = async (): Promise<EventSuggestion[]> => {
  const { data } = await api.get<{ suggestions?: EventSuggestion[] }>('/events/suggestions');
  return data.suggestions ?? [];
};

export const fetchSavedEvents = async (): Promise<SavedEvent[]> => {
  const { data } = await api.get<{ events?: SavedEvent[] } | SavedEvent[]>('/events/saved');
  if (Array.isArray(data)) return data;
  return data.events ?? [];
};

export const fetchNotifications = async (): Promise<Notification[]> => {
  const { data } = await api.get<Notification[]>('/notifications');
  return data ?? [];
};

export const fetchUserSettings = async (): Promise<UserSettings> => {
  const { data } = await api.get<UserSettings>('/users/me');
  return data;
};

export const fetchCalendarEvents = async (days: number): Promise<CalendarEvent[]> => {
  const { data } = await api.get<{ events?: CalendarEvent[] }>(`/calendar/events?days=${days}`);
  return data.events ?? [];
};

export const fetchDiscoverEvents = async (params: EventDiscoverParams): Promise<EventResult[]> => {
  const { data } = await api.get<{ events?: EventResult[] }>('/events/discover', { params });
  return data.events ?? [];
};

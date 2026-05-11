import api from './api';

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  meetups: ['meetups'] as const,
  friends: ['friends'] as const,
  notifications: ['notifications'] as const,
  settings: ['settings'] as const,
};

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
    photoUrl?: string;
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
  social_battery?: string;
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
  proposed_start_time?: string;
  proposed_end_time?: string;
}

export const fetchDashboard = async (): Promise<FriendToSee[]> => {
  const { data } = await api.get<{ friendsToSee?: FriendToSee[] }>('/dashboard');
  return data.friendsToSee ?? [];
};

export const fetchMeetups = async (): Promise<Meetup[]> => {
  const { data } = await api.get<{ meetups?: Meetup[] }>('/meetups');
  return data.meetups ?? [];
};

export const fetchFriends = async (): Promise<FriendRecord[]> => {
  const { data } = await api.get<{ friends?: FriendRecord[] }>('/friends');
  return data.friends ?? [];
};
export const fetchNotifications = async (): Promise<Notification[]> => {
  const { data } = await api.get<Notification[]>('/notifications');
  return data ?? [];
};

export const fetchUserSettings = async (): Promise<UserSettings> => {
  const { data } = await api.get<UserSettings>('/users/me');
  return data;
};

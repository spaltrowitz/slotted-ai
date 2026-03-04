// ---------------------------------------------------------------------------
// SlottedClient — typed SDK that wraps the Slotted REST API
// ---------------------------------------------------------------------------
// Each test agent gets its own SlottedClient instance, authenticated via
// a Firebase custom token minted from the service account.
// ---------------------------------------------------------------------------

import * as admin from "firebase-admin";
import { AgentPersona } from "./personas.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SlottedUser {
  id: string;
  firebase_uid: string;
  email: string;
  display_name: string;
  photo_url?: string;
  timezone: string;
  social_battery: string;
  onboarded: boolean;
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  related_user_id?: string;
  related_id?: string;
  read: boolean;
  created_at: string;
  related_user?: { display_name: string; photo_url?: string };
  my_rsvp?: string;
  meetup_status?: string;
}

export interface Meetup {
  id: string;
  title: string;
  status: string;
  start_time: string;
  end_time: string;
  location?: string;
  created_at: string;
  my_rsvp?: string;
  is_organizer?: boolean;
}

export interface Friendship {
  id: string;
  user_a_id: string;
  user_b_id: string;
  status: string;
  created_at: string;
  user_a?: { id: string; display_name: string; email: string };
  user_b?: { id: string; display_name: string; email: string };
}

export interface DashboardData {
  friends: unknown[];
  upcomingMeetups: unknown[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
export class SlottedClient {
  private baseUrl: string;
  private adminSecret: string;
  private idToken: string | null = null;
  private supabaseUserId: string | null = null;

  public persona: AgentPersona;

  constructor(
    persona: AgentPersona,
    opts: {
      baseUrl?: string;
      adminSecret?: string;
    } = {},
  ) {
    this.persona = persona;
    this.baseUrl = (opts.baseUrl || process.env.API_BASE_URL || "https://slotted-ai.web.app/api").replace(/\/$/, "");
    this.adminSecret = opts.adminSecret || process.env.ADMIN_SECRET || "slotted-admin-2026";
  }

  // -------------------------------------------------------------------------
  // Auth — mint a Firebase ID token from the service account
  // -------------------------------------------------------------------------
  async authenticate(): Promise<void> {
    const firebaseUid = process.env[this.persona.envUidKey];
    if (!firebaseUid) {
      throw new Error(
        `Missing env var ${this.persona.envUidKey}. ` +
        `Set it to the Firebase UID for ${this.persona.email}.`,
      );
    }

    // Mint a custom token, then exchange it for an ID token via the REST API
    const customToken = await admin.auth().createCustomToken(firebaseUid);

    // Exchange custom token → ID token via Firebase Auth REST API
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing FIREBASE_API_KEY env var. " +
        "Find it in Firebase Console → Project Settings → General → Web API Key.",
      );
    }

    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      },
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Failed to exchange custom token: ${resp.status} ${body}`);
    }

    const data = (await resp.json()) as { idToken: string };
    this.idToken = data.idToken;
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------
  private async request<T = unknown>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string>; auth?: "user" | "admin" | "none" } = {},
  ): Promise<{ status: number; data: T }> {
    const auth = opts.auth ?? "user";
    let url = `${this.baseUrl}${path}`;

    if (opts.query) {
      const qs = new URLSearchParams(opts.query).toString();
      url += `?${qs}`;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (auth === "user") {
      if (!this.idToken) throw new Error("Not authenticated — call authenticate() first");
      headers["Authorization"] = `Bearer ${this.idToken}`;
    } else if (auth === "admin") {
      headers["X-Admin-Secret"] = this.adminSecret;
    }

    const fetchOpts: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      fetchOpts.body = JSON.stringify(opts.body);
    }

    const resp = await fetch(url, fetchOpts);
    let data: T;
    const text = await resp.text();
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as unknown as T;
    }

    return { status: resp.status, data };
  }

  private get<T = unknown>(path: string, opts?: { query?: Record<string, string>; auth?: "user" | "admin" | "none" }) {
    return this.request<T>("GET", path, opts);
  }
  private post<T = unknown>(path: string, body?: unknown, opts?: { auth?: "user" | "admin" | "none" }) {
    return this.request<T>("POST", path, { body, ...opts });
  }
  private patch<T = unknown>(path: string, body?: unknown, opts?: { auth?: "user" | "admin" | "none" }) {
    return this.request<T>("PATCH", path, { body, ...opts });
  }
  private put<T = unknown>(path: string, body?: unknown, opts?: { auth?: "user" | "admin" | "none" }) {
    return this.request<T>("PUT", path, { body, ...opts });
  }
  private del<T = unknown>(path: string, opts?: { query?: Record<string, string>; auth?: "user" | "admin" | "none" }) {
    return this.request<T>("DELETE", path, opts);
  }

  // -------------------------------------------------------------------------
  // User
  // -------------------------------------------------------------------------
  async getMe(): Promise<SlottedUser> {
    const { data } = await this.get<SlottedUser>("/users/me");
    this.supabaseUserId = (data as any).id;
    return data;
  }

  async upsertMe(overrides: Record<string, unknown> = {}): Promise<SlottedUser> {
    const { data } = await this.post<SlottedUser>("/users/me", {
      display_name: this.persona.displayName,
      timezone: this.persona.timezone,
      ...overrides,
    });
    this.supabaseUserId = (data as any).id;
    return data;
  }

  async completeOnboarding(): Promise<unknown> {
    const { data } = await this.post("/users/me/onboarding", {
      social_frequency: this.persona.socialFrequency,
      preferred_times: this.persona.preferredTimes,
      travel_buffer_min: this.persona.travelBufferMin,
      social_battery: this.persona.socialBattery,
      neighborhood: this.persona.neighborhood,
      planning_style: this.persona.planningStyle,
    });
    return data;
  }

  async updateBattery(level: "open" | "ask_me" | "recharging"): Promise<unknown> {
    const { data } = await this.patch("/users/me/battery", { social_battery: level });
    return data;
  }

  // -------------------------------------------------------------------------
  // Friends
  // -------------------------------------------------------------------------
  async getFriends(): Promise<Friendship[]> {
    const { data } = await this.get<Friendship[]>("/friends");
    return data;
  }

  async sendFriendRequest(toEmail: string): Promise<unknown> {
    const { data } = await this.post("/friends/invite", { email: toEmail });
    return data;
  }

  async acceptFriendship(friendshipId: string): Promise<unknown> {
    const { data } = await this.patch(`/friends/${friendshipId}`, { status: "accepted" });
    return data;
  }

  async declineFriendship(friendshipId: string): Promise<unknown> {
    const { data } = await this.patch(`/friends/${friendshipId}`, { status: "declined" });
    return data;
  }

  async removeFriend(friendshipId: string): Promise<unknown> {
    const { data } = await this.del(`/friends/${friendshipId}`);
    return data;
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------
  async getNotifications(): Promise<Notification[]> {
    const { data } = await this.get<Notification[]>("/notifications");
    return data;
  }

  async getUnreadCount(): Promise<number> {
    const { data } = await this.get<{ count: number }>("/notifications/unread-count");
    return (data as any).count ?? 0;
  }

  async markNotificationRead(notifId: string): Promise<unknown> {
    const { data } = await this.patch(`/notifications/${notifId}/read`);
    return data;
  }

  async markAllNotificationsRead(): Promise<unknown> {
    const { data } = await this.post("/notifications/mark-all-read");
    return data;
  }

  async deleteNotification(notifId: string): Promise<unknown> {
    const { data } = await this.del(`/notifications/${notifId}`);
    return data;
  }

  // -------------------------------------------------------------------------
  // Meetups
  // -------------------------------------------------------------------------
  async createMeetup(opts: {
    friendIds: string[];
    title?: string;
    startTime: string;
    endTime: string;
    location?: string;
    activity?: string;
  }): Promise<unknown> {
    const { data } = await this.post("/meetups", {
      friend_ids: opts.friendIds,
      title: opts.title || "Test Meetup",
      start_time: opts.startTime,
      end_time: opts.endTime,
      location: opts.location,
      activity: opts.activity,
    });
    return data;
  }

  async getMeetups(): Promise<Meetup[]> {
    const { data } = await this.get<Meetup[]>("/meetups");
    return data;
  }

  async rsvpMeetup(meetupId: string, rsvp: "accepted" | "declined" | "maybe"): Promise<unknown> {
    const { data } = await this.patch(`/meetups/${meetupId}/rsvp`, { rsvp });
    return data;
  }

  async counterPropose(meetupId: string, newTime: { startTime: string; endTime: string }): Promise<unknown> {
    const { data } = await this.post(`/meetups/${meetupId}/counter-propose`, {
      start_time: newTime.startTime,
      end_time: newTime.endTime,
    });
    return data;
  }

  async markDidntHappen(meetupId: string, reason?: string): Promise<unknown> {
    const { data } = await this.patch(`/meetups/${meetupId}/didnt-happen`, { reason });
    return data;
  }

  // -------------------------------------------------------------------------
  // Dashboard & Activity
  // -------------------------------------------------------------------------
  async getDashboard(): Promise<DashboardData> {
    const { data } = await this.get<DashboardData>("/dashboard");
    return data;
  }

  async getActivityFeed(): Promise<unknown[]> {
    const { data } = await this.get<unknown[]>("/activity-feed");
    return data;
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------
  async getAvailability(): Promise<unknown> {
    const { data } = await this.get("/availability");
    return data;
  }

  async getOverlap(friendId: string, mode?: "in_person" | "phone" | "video"): Promise<unknown> {
    const query: Record<string, string> = {};
    if (mode) query.mode = mode;
    const { data } = await this.get(`/availability/overlap/${friendId}`, { query });
    return data;
  }

  async getGroupOverlap(friendIds: string[]): Promise<unknown> {
    const { data } = await this.post("/availability/group-overlap", { friend_ids: friendIds });
    return data;
  }

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------
  async getGroups(): Promise<unknown[]> {
    const { data } = await this.get<unknown[]>("/groups");
    return data;
  }

  async createGroup(name: string, memberIds: string[], emoji?: string): Promise<unknown> {
    const { data } = await this.post("/groups", { name, member_ids: memberIds, emoji });
    return data;
  }

  async updateGroup(groupId: string, updates: { name?: string; emoji?: string }): Promise<unknown> {
    const { data } = await this.put(`/groups/${groupId}`, updates);
    return data;
  }

  async addGroupMembers(groupId: string, memberIds: string[]): Promise<unknown> {
    const { data } = await this.post(`/groups/${groupId}/members`, { memberIds });
    return data;
  }

  async deleteGroup(groupId: string): Promise<{ status: number; data: unknown }> {
    return this.request("DELETE", `/groups/${groupId}`);
  }

  // -------------------------------------------------------------------------
  // Busy Blocks
  // -------------------------------------------------------------------------
  async getBusyBlocks(): Promise<unknown> {
    const { data } = await this.get("/busy-blocks");
    return data;
  }

  async createBusyBlock(block: { start_time: string; end_time: string; label?: string }): Promise<unknown> {
    const { data } = await this.post("/busy-blocks", block);
    return data;
  }

  async batchBusyBlocks(blocks: { start_time: string; end_time: string; label?: string }[]): Promise<unknown> {
    const { data } = await this.post("/busy-blocks/batch", { blocks });
    return data;
  }

  async deleteBusyBlock(blockId: string): Promise<{ status: number; data: unknown }> {
    return this.request("DELETE", `/busy-blocks/${blockId}`);
  }

  // -------------------------------------------------------------------------
  // Calendar (extended)
  // -------------------------------------------------------------------------
  async getCalendarStatus(): Promise<unknown> {
    const { data } = await this.get("/calendar/status");
    return data;
  }

  async syncCalendar(): Promise<unknown> {
    const { data } = await this.post("/calendar/sync");
    return data;
  }

  async getCalendarEvents(days?: number): Promise<unknown> {
    const query: Record<string, string> = {};
    if (days) query.days = String(days);
    const { data } = await this.get("/calendar/events", { query });
    return data;
  }

  async getCalendarList(): Promise<unknown> {
    const { data } = await this.get("/calendar/list");
    return data;
  }

  async getSelectedCalendars(): Promise<unknown> {
    const { data } = await this.get("/calendar/selected");
    return data;
  }

  async updateSelectedCalendars(calendars: unknown): Promise<unknown> {
    const { data } = await this.put("/calendar/selected", calendars);
    return data;
  }

  // -------------------------------------------------------------------------
  // Events (saved & invites)
  // -------------------------------------------------------------------------
  async getSavedEvents(): Promise<unknown[]> {
    const { data } = await this.get<unknown[]>("/events/saved");
    return data;
  }

  async saveEvent(event: Record<string, unknown>): Promise<unknown> {
    const { data } = await this.post("/events/save", { event });
    return data;
  }

  async deleteSavedEvent(eventId: string): Promise<{ status: number; data: unknown }> {
    return this.request("DELETE", `/events/saved/${eventId}`);
  }

  async updateSavedEvent(eventId: string, updates: Record<string, unknown>): Promise<unknown> {
    const { data } = await this.patch(`/events/saved/${eventId}`, updates);
    return data;
  }

  async inviteToEvent(friendIds: string[], event: Record<string, unknown>, message?: string): Promise<unknown> {
    const { data } = await this.post("/events/invite", { friendIds, event, message });
    return data;
  }

  async getEventInvites(): Promise<unknown[]> {
    const { data } = await this.get<unknown[]>("/events/invites");
    return data;
  }

  async respondToEventInvite(inviteId: string, rsvp: "accepted" | "declined"): Promise<unknown> {
    const { data } = await this.patch(`/events/invites/${inviteId}`, { rsvp });
    return data;
  }

  // -------------------------------------------------------------------------
  // Raw request access (for error handling tests)
  // -------------------------------------------------------------------------
  async rawRequest<T = unknown>(
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string>; auth?: "user" | "admin" | "none" },
  ): Promise<{ status: number; data: T }> {
    return this.request<T>(method, path, opts);
  }

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------
  async submitFeedback(text: string): Promise<unknown> {
    const { data } = await this.post("/feedback", { text });
    return data;
  }

  // -------------------------------------------------------------------------
  // Admin endpoints (bypass user auth, use admin secret)
  // -------------------------------------------------------------------------
  async adminGetUsers(): Promise<SlottedUser[]> {
    const { data } = await this.get<SlottedUser[]>("/admin/users", { auth: "admin" });
    return data;
  }

  async adminGetUser(userId: string): Promise<SlottedUser> {
    const { data } = await this.get<SlottedUser>(`/admin/users/${userId}`, { auth: "admin" });
    return data;
  }

  async adminGetNotifications(userId: string): Promise<Notification[]> {
    const { data } = await this.get<Notification[]>(`/admin/users/${userId}/notifications`, { auth: "admin" });
    return data;
  }

  async adminDeleteNotifications(userId: string, opts?: { type?: string; olderThan?: string }): Promise<unknown> {
    const query: Record<string, string> = {};
    if (opts?.type) query.type = opts.type;
    if (opts?.olderThan) query.olderThan = opts.olderThan;
    const { data } = await this.del(`/admin/users/${userId}/notifications`, { query, auth: "admin" });
    return data;
  }

  async adminDeleteNotification(notifId: string): Promise<unknown> {
    const { data } = await this.del(`/admin/notifications/${notifId}`, { auth: "admin" });
    return data;
  }

  async adminGetFcmTokens(userId: string): Promise<unknown[]> {
    const { data } = await this.get<unknown[]>(`/admin/users/${userId}/fcm-tokens`, { auth: "admin" });
    return data;
  }

  async adminClearFcmTokens(userId: string): Promise<unknown> {
    const { data } = await this.del(`/admin/users/${userId}/fcm-tokens`, { auth: "admin" });
    return data;
  }

  async adminGetMeetups(userId: string): Promise<Meetup[]> {
    const { data } = await this.get<Meetup[]>(`/admin/users/${userId}/meetups`, { auth: "admin" });
    return data;
  }

  async adminGetFriendships(userId: string): Promise<Friendship[]> {
    const { data } = await this.get<Friendship[]>(`/admin/users/${userId}/friendships`, { auth: "admin" });
    return data;
  }

  async adminGetStats(): Promise<Record<string, number>> {
    const { data } = await this.get<Record<string, number>>("/admin/stats", { auth: "admin" });
    return data;
  }

  // -------------------------------------------------------------------------
  // Helper: get the Supabase user ID (lazy loaded)
  // -------------------------------------------------------------------------
  async getSupabaseUserId(): Promise<string> {
    if (this.supabaseUserId) return this.supabaseUserId;
    const me = await this.getMe();
    return me.id;
  }
}

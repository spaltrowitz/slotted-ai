import { getSupabase } from "../supabase";

interface FriendPattern {
  friendId: string;
  friendName: string;
  topActivity: string;
  avgDuration: number;
  preferredDay: string;
  preferredTime: string;
  avgCadenceDays: number;
  daysSinceLastHangout: number;
  overdue: boolean;
  totalHangouts: number;
  topRatedActivity?: string;
  planningStyle: "spontaneous" | "planner" | "mixed";
  confidence: number;
}

interface SmartSuggestion {
  friendId: string;
  friendName: string;
  activity: string;
  reason: string;
  timeHint: string;
  urgency: "overdue" | "normal" | "new_friend";
  confidence: number;
}

export type { FriendPattern, SmartSuggestion };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const ACTIVITY_LABELS: Record<string, string> = {
  coffee: "grab coffee", meal: "get a meal", drinks: "get drinks",
  walk: "go for a walk", workout: "work out", movie: "see a movie",
  game_night: "do a game night", phone_call: "catch up on the phone",
  facetime: "FaceTime", video_call: "hop on a call", other: "hang out",
};

function mostCommon<T>(items: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let best: T | undefined;
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) { best = item; bestCount = count; }
  }
  return best;
}

export async function analyzeFriendPatterns(userId: string): Promise<FriendPattern[]> {
  const sb = getSupabase();

  const { data: logs } = await sb
    .from("meetup_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (!logs || logs.length === 0) return [];

  const friendIds = [...new Set(logs.map(l => l.friend_id).filter(Boolean))];
  const { data: friends } = friendIds.length > 0
    ? await sb.from("users").select("id, display_name").in("id", friendIds)
    : { data: [] };
  const friendMap = new Map((friends || []).map((f: any) => [f.id, f.display_name]));

  const byFriend = new Map<string, typeof logs>();
  for (const log of logs) {
    if (!log.friend_id) continue;
    const existing = byFriend.get(log.friend_id) || [];
    existing.push(log);
    byFriend.set(log.friend_id, existing);
  }

  const now = new Date();
  const patterns: FriendPattern[] = [];

  for (const [friendId, friendLogs] of byFriend) {
    if (friendLogs.length === 0) continue;

    const topActivity = mostCommon(friendLogs.map(l => l.activity_type)) || "other";

    const durations = friendLogs.filter(l => l.duration_min).map(l => l.duration_min);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
      : 60;

    const daysWithData = friendLogs.filter(l => l.day_of_week != null).map(l => l.day_of_week);
    const topDayNum = mostCommon(daysWithData);
    const isWeekend = topDayNum != null && (topDayNum === 0 || topDayNum === 6);
    const preferredDay = topDayNum != null ? (isWeekend ? DAY_NAMES[topDayNum] : "Weekday") : "any";

    const timesWithData = friendLogs.filter(l => l.time_of_day).map(l => l.time_of_day);
    const preferredTime = mostCommon(timesWithData) || "afternoon";

    const sortedDates = friendLogs.map(l => new Date(l.created_at).getTime()).sort((a, b) => a - b);
    let avgCadenceDays = 14;
    if (sortedDates.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < sortedDates.length; i++) {
        gaps.push((sortedDates[i] - sortedDates[i - 1]) / 86400000);
      }
      avgCadenceDays = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    }

    const lastHangout = sortedDates[sortedDates.length - 1];
    const daysSince = Math.floor((now.getTime() - lastHangout) / 86400000);

    const rated = friendLogs.filter(l => l.rating);
    let topRatedActivity: string | undefined;
    if (rated.length > 0) {
      const ratingByActivity = new Map<string, { total: number; count: number }>();
      for (const l of rated) {
        const existing = ratingByActivity.get(l.activity_type) || { total: 0, count: 0 };
        existing.total += l.rating;
        existing.count += 1;
        ratingByActivity.set(l.activity_type, existing);
      }
      topRatedActivity = [...ratingByActivity.entries()]
        .map(([act, { total, count }]) => ({ act, avg: total / count }))
        .sort((a, b) => b.avg - a.avg)[0]?.act;
    }

    const spontaneous = friendLogs.filter(l => l.was_spontaneous).length;
    const planned = friendLogs.length - spontaneous;
    const planningStyle: FriendPattern["planningStyle"] =
      spontaneous > planned * 2 ? "spontaneous" : planned > spontaneous * 2 ? "planner" : "mixed";

    const confidence = Math.min(friendLogs.length / 10, 1);

    patterns.push({
      friendId,
      friendName: friendMap.get(friendId)?.split(" ")[0] || "Friend",
      topActivity,
      avgDuration,
      preferredDay,
      preferredTime,
      avgCadenceDays: Math.max(avgCadenceDays, 1),
      daysSinceLastHangout: daysSince,
      overdue: daysSince > avgCadenceDays * 1.5,
      totalHangouts: friendLogs.length,
      topRatedActivity,
      planningStyle,
      confidence,
    });
  }

  patterns.sort((a, b) => {
    if (a.overdue && !b.overdue) return -1;
    if (!a.overdue && b.overdue) return 1;
    return (b.daysSinceLastHangout / b.avgCadenceDays) - (a.daysSinceLastHangout / a.avgCadenceDays);
  });

  return patterns;
}

export async function generateSmartSuggestions(userId: string): Promise<SmartSuggestion[]> {
  const patterns = await analyzeFriendPatterns(userId);
  if (patterns.length === 0) return [];

  const suggestions: SmartSuggestion[] = [];

  for (const p of patterns.slice(0, 5)) {
    const activityLabel = ACTIVITY_LABELS[p.topRatedActivity || p.topActivity] || "hang out";
    const timeHint = `${p.preferredDay} ${p.preferredTime}`;

    let reason: string;
    let urgency: SmartSuggestion["urgency"];

    if (p.totalHangouts < 2) {
      reason = `You're new friends — time to ${activityLabel}?`;
      urgency = "new_friend";
    } else if (p.overdue) {
      reason = `It's been ${p.daysSinceLastHangout} days — you usually ${activityLabel} every ~${p.avgCadenceDays} days`;
      urgency = "overdue";
    } else {
      reason = `You usually ${activityLabel} on ${timeHint}s`;
      urgency = "normal";
    }

    suggestions.push({
      friendId: p.friendId,
      friendName: p.friendName,
      activity: p.topRatedActivity || p.topActivity,
      reason,
      timeHint,
      urgency,
      confidence: p.confidence,
    });
  }

  return suggestions.slice(0, 3);
}

export async function updateUserPreferences(userId: string): Promise<void> {
  const sb = getSupabase();

  const { data: logs } = await sb
    .from("meetup_logs")
    .select("activity_type, duration_min, day_of_week, time_of_day, notice_days, was_spontaneous")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!logs || logs.length === 0) return;

  const activityCounts = new Map<string, number>();
  const timeCounts = new Map<string, number>();
  const dayCounts = new Map<number, number>();
  let totalDuration = 0;
  let durationCount = 0;
  let spontaneousCount = 0;

  for (const l of logs) {
    activityCounts.set(l.activity_type, (activityCounts.get(l.activity_type) || 0) + 1);
    if (l.time_of_day) timeCounts.set(l.time_of_day, (timeCounts.get(l.time_of_day) || 0) + 1);
    if (l.day_of_week != null) dayCounts.set(l.day_of_week, (dayCounts.get(l.day_of_week) || 0) + 1);
    if (l.duration_min) { totalDuration += l.duration_min; durationCount++; }
    if (l.was_spontaneous) spontaneousCount++;
  }

  const topActivity = [...activityCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topTime = [...timeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topDayNum = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : null;
  const planningStyle = spontaneousCount > logs.length * 0.6
    ? "spontaneous"
    : spontaneousCount < logs.length * 0.3 ? "planner" : "mixed";

  await sb.from("user_preferences").upsert({
    user_id: userId,
    preferred_activity: topActivity,
    avg_duration_min: avgDuration,
    preferred_time: topTime,
    preferred_day: topDayNum != null ? DAY_NAMES[topDayNum] : null,
    planning_style: planningStyle,
    total_meetups_logged: logs.length,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
}

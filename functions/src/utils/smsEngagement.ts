import { getSupabase } from "../supabase";
import { sendSMS, createSMSAction } from "./sms";

const MAX_TEXTS_PER_WEEK = 2;
const MAX_TEXTS_ONBOARDING_WEEK = 4; // Higher cap during first week (welcome + push + invite + first meetup)

const ONBOARDING_TYPES = new Set(["welcome", "enable_push", "invite_friend", "first_meetup"]);

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toISOString().split("T")[0];
}

function isQuietHours(timezone: string): boolean {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: timezone || "America/New_York",
      }).format(new Date()),
    );
    return hour < 9 || hour >= 21;
  } catch {
    return false;
  }
}

async function isOptedOut(phoneNumber: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from("sms_opt_outs")
    .select("phone_number")
    .eq("phone_number", phoneNumber)
    .maybeSingle();
  return !!data;
}

async function canSendThisWeek(userId: string, messageType: string): Promise<boolean> {
  const sb = getSupabase();
  const weekStart = getWeekStart();
  const { data } = await sb
    .from("sms_weekly_counts")
    .select("count")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  const limit = ONBOARDING_TYPES.has(messageType) ? MAX_TEXTS_ONBOARDING_WEEK : MAX_TEXTS_PER_WEEK;
  return !data || data.count < limit;
}

async function incrementWeeklyCount(userId: string): Promise<void> {
  const sb = getSupabase();
  const weekStart = getWeekStart();
  const { error } = await sb
    .from("sms_weekly_counts")
    .upsert(
      { user_id: userId, week_start: weekStart, count: 1 },
      { onConflict: "user_id,week_start" },
    );

  if (error) {
    console.error("[SMS_ENGAGEMENT] Failed to increment weekly count:", error.message);
  }
}

async function alreadySent(userId: string, messageType: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from("sms_lifecycle_log")
    .select("id")
    .eq("user_id", userId)
    .eq("message_type", messageType)
    .maybeSingle();
  return !!data;
}

async function logLifecycleMessage(userId: string, messageType: string): Promise<void> {
  await getSupabase()
    .from("sms_lifecycle_log")
    .upsert(
      { user_id: userId, message_type: messageType, sent_at: new Date().toISOString() },
      { onConflict: "user_id,message_type" },
    );
}

/**
 * Send an engagement SMS if all conditions are met:
 * - User has phone number
 * - Not opted out
 * - Not in quiet hours
 * - Under weekly limit
 * - This lifecycle message not already sent
 * 
 * Dedup: logs the message BEFORE sending to prevent race conditions
 * from concurrent scheduled function runs.
 */
export async function sendEngagementSMS(
  userId: string,
  phoneNumber: string,
  timezone: string,
  messageType: string,
  message: string,
  actionType?: string,
  actionData?: Record<string, string>,
): Promise<boolean> {
  if (!phoneNumber) return false;
  if (await isOptedOut(phoneNumber)) return false;
  if (isQuietHours(timezone)) return false;
  if (!(await canSendThisWeek(userId, messageType))) return false;
  if (await alreadySent(userId, messageType)) return false;

  // Log FIRST to claim the slot (prevents duplicates from concurrent runs)
  // The UNIQUE constraint on (user_id, message_type) acts as a DB-level lock
  const { error: claimError } = await getSupabase()
    .from("sms_lifecycle_log")
    .insert({ user_id: userId, message_type: messageType, sent_at: new Date().toISOString() });

  if (claimError) {
    // Unique constraint violation = another process already claimed it
    if (claimError.code === "23505") return false;
    console.error("[SMS_ENGAGEMENT] Claim error:", claimError.message);
    return false;
  }

  const fullMessage = message.includes("STOP")
    ? message
    : message + "\nReply STOP to opt out";

  const sent = await sendSMS(phoneNumber, fullMessage);
  if (sent) {
    await incrementWeeklyCount(userId);
    if (actionType && actionData) {
      await createSMSAction(phoneNumber, userId, actionType, actionData);
    }
  } else {
    // Send failed — roll back the claim so it can retry next cycle
    await getSupabase()
      .from("sms_lifecycle_log")
      .delete()
      .eq("user_id", userId)
      .eq("message_type", messageType);
  }
  return sent;
}

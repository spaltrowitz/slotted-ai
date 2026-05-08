import { getSupabase } from "../supabase";
import { sendSMS, createSMSAction, SMS_TEMPLATES, formatSMSDate } from "./sms";

/**
 * Send an SMS notification alongside the in-app notification.
 * Only sends if user has a phone_number and hasn't opted out.
 * Dedup: checks sms_pending_actions to avoid double-texting for same event.
 */
export async function sendSMSNotification(
  userId: string,
  type: string,
  context: Record<string, string>,
): Promise<void> {
  const sb = getSupabase();

  const { data: user } = await sb
    .from("users")
    .select("id, phone_number, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (!user?.phone_number) return;

  const { data: optOut } = await sb
    .from("sms_opt_outs")
    .select("phone_number")
    .eq("phone_number", user.phone_number)
    .maybeSingle();

  if (optOut) return;

  // Dedup: if there's already a pending action for this phone + same type, skip
  const dedupKey = context.meetupId || context.friendshipId || "";
  if (dedupKey) {
    const { data: existing } = await sb
      .from("sms_pending_actions")
      .select("id")
      .eq("phone_number", user.phone_number)
      .eq("action_type", type === "meetup_request" ? "meetup_proposal" : type === "friend_request" ? "friend_request" : type)
      .maybeSingle();
    if (existing) return; // Already texted about this
  }

  let message = "";
  let actionType = "";
  let actionData: Record<string, string> = {};

  switch (type) {
    case "friend_request":
      message = SMS_TEMPLATES.friendRequest(context.fromName);
      actionType = "friend_request";
      actionData = {
        friendshipId: context.friendshipId,
        fromUserId: context.fromUserId,
        userName: user.display_name || "",
      };
      break;

    case "meetup_request":
      message = SMS_TEMPLATES.meetupProposal(
        context.fromName,
        formatSMSDate(context.startTime),
        context.title || "Hangout",
      );
      actionType = "meetup_proposal";
      actionData = {
        meetupId: context.meetupId,
        notificationId: context.notificationId || "",
      };
      break;

    case "meetup_confirmed":
      message = SMS_TEMPLATES.meetupConfirmed(
        context.title || "Hangout",
        formatSMSDate(context.startTime),
      );
      break;

    case "meetup_reminder":
      message = SMS_TEMPLATES.reminder(
        context.title || "Hangout",
        formatSMSDate(context.startTime),
      );
      actionType = "reminder";
      actionData = { meetupId: context.meetupId };
      break;

    default:
      return;
  }

  if (!message) return;

  await sendSMS(user.phone_number, message);

  if (actionType) {
    await createSMSAction(user.phone_number, userId, actionType, actionData);
  }
}

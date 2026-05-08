import { getSupabase } from "../supabase";

// SMS Provider — supports ClickSend and Telnyx. Set SMS_PROVIDER env var to switch.
const SMS_PROVIDER = process.env.SMS_PROVIDER || "telnyx"; // "telnyx" | "clicksend"

// Telnyx config
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || "";
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER || "";

// ClickSend config
const CLICKSEND_USERNAME = process.env.CLICKSEND_USERNAME || "";
const CLICKSEND_API_KEY = process.env.CLICKSEND_API_KEY || "";
const CLICKSEND_AUTH = Buffer.from(`${CLICKSEND_USERNAME}:${CLICKSEND_API_KEY}`).toString("base64");

const SLOTTED_PHONE_NUMBER = process.env.SLOTTED_PHONE_NUMBER || TELNYX_PHONE_NUMBER || "";

async function sendViaTelnyx(to: string, body: string): Promise<boolean> {
  if (!TELNYX_API_KEY) return false;
  const resp = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: TELNYX_PHONE_NUMBER || SLOTTED_PHONE_NUMBER,
      to,
      text: body,
    }),
  });
  if (!resp.ok) {
    console.error(`[SMS:Telnyx] Error ${resp.status}:`, await resp.text());
    return false;
  }
  return true;
}

async function sendViaClickSend(to: string, body: string): Promise<boolean> {
  if (!CLICKSEND_USERNAME || !CLICKSEND_API_KEY) return false;
  const resp = await fetch("https://rest.clicksend.com/v3/sms/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${CLICKSEND_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ from: SLOTTED_PHONE_NUMBER, to, body, source: "slotted" }],
    }),
  });
  if (!resp.ok) {
    console.error(`[SMS:ClickSend] Error ${resp.status}:`, await resp.text());
    return false;
  }
  return true;
}

export async function sendSMS(to: string, body: string): Promise<boolean> {
  const hasProvider = SMS_PROVIDER === "telnyx" ? !!TELNYX_API_KEY : !!(CLICKSEND_USERNAME && CLICKSEND_API_KEY);
  if (!hasProvider) {
    console.warn(`[SMS] ${SMS_PROVIDER} not configured — skipping SMS`);
    return false;
  }

  try {
    return SMS_PROVIDER === "telnyx"
      ? await sendViaTelnyx(to, body)
      : await sendViaClickSend(to, body);
  } catch (err) {
    console.error("[SMS] Send failed:", err);
    return false;
  }
}

export const SMS_TEMPLATES = {
  welcome: (url: string) =>
    `hey! welcome to slotted 📅 i'll help you and your friends actually make plans.\nconnect your calendar: ${url}`,

  friendRequest: (fromName: string) =>
    `hey! ${fromName} just added you on slotted. reply 1 to connect, 2 to skip`,

  meetupProposal: (fromName: string, date: string, activity: string) =>
    `${fromName} wants to hang! ${date} — ${activity}. reply 1 yes, 2 different time, 3 not this time`,

  meetupConfirmed: (title: string, date: string) =>
    `you're all set! ${title}, ${date}. added to your calendar 📅`,

  counterPropose: (fromName: string, date: string, activity: string) =>
    `${fromName} suggested a different time: ${date} — ${activity}. reply 1 yes, 2 not this time`,

  reminder: (title: string, date: string) =>
    `reminder: ${title} is ${date}. reply 1 see you there, 2 can't make it`,

  cancellation: (friendName: string) =>
    `${friendName} can't make it anymore. want me to find another time? reply 1 yes, 2 no`,

  eventPoll: (fromName: string, eventTitle: string, options: string) =>
    `${fromName} wants to see ${eventTitle}!\n${options}\nreply the numbers that work (e.g. "1 2")`,

  nudge: (friendName: string, weeks: number) =>
    `you and ${friendName} haven't hung out in ${weeks} weeks. want me to find a time? reply 1 yeah`,
};

export function formatSMSDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export async function createSMSAction(
  phoneNumber: string,
  userId: string,
  actionType: string,
  actionData: Record<string, string>,
): Promise<void> {
  await getSupabase()
    .from("sms_pending_actions")
    .upsert({
      phone_number: phoneNumber,
      user_id: userId,
      action_type: actionType,
      action_data: actionData,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "phone_number" });
}

export async function getPendingSMSAction(phoneNumber: string) {
  const { data } = await getSupabase()
    .from("sms_pending_actions")
    .select("*")
    .eq("phone_number", phoneNumber)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

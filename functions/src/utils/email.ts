import { getSupabase } from "../supabase";

/**
 * Send a transactional email via Resend. Returns true if the API call
 * succeeded, false otherwise (missing config, missing recipient email, or
 * non-2xx response). Failures are logged but never thrown — email is a
 * best-effort fallback channel.
 */
export async function sendEmail(opts: {
  userId: string;
  subject: string;
  body: string;
  logTag?: string;
}): Promise<boolean> {
  const tag = opts.logTag || "EMAIL";
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_EMAIL || "noreply@slottedapp.com";
  const fromName = process.env.RESEND_FROM_NAME || "Slotted.ai";
  const from = fromAddress.includes("<") ? fromAddress : `${fromName} <${fromAddress}>`;
  if (!apiKey) {
    console.log(`[${tag}] RESEND_API_KEY not configured; skipped email for ${opts.userId}`);
    return false;
  }

  const { data: user, error } = await getSupabase()
    .from("users")
    .select("email, display_name")
    .eq("id", opts.userId)
    .maybeSingle();
  if (error || !user?.email) {
    console.warn(`[${tag}] Could not load email for ${opts.userId}: ${error?.message || "missing email"}`);
    return false;
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: user.email,
        subject: opts.subject,
        text: opts.body,
      }),
    });

    if (!resp.ok) {
      console.error(`[${tag}] Failed to email ${user.email}: ${resp.status} ${await resp.text()}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[${tag}] Send failed for ${user.email}: ${err.message}`);
    return false;
  }
}

/**
 * Email fallback for an event poll nudge. Sent in addition to the in-app +
 * FCM push, so friends who haven't granted push permission still hear about
 * the nudge through email.
 */
export async function sendEventPollNudgeEmail(opts: {
  userId: string;
  fromName: string;
  eventTitle: string;
}): Promise<boolean> {
  const subject = `${opts.fromName} is waiting on your ${opts.eventTitle} picks`;
  const body =
    `Hey,\n\n` +
    `${opts.fromName} is waiting on your availability for ${opts.eventTitle}.\n\n` +
    `Open Slotted.ai to pick the dates that work for you:\n` +
    `https://slotted-ai.web.app\n\n` +
    `— Slotted.ai`;
  return sendEmail({ userId: opts.userId, subject, body, logTag: "EMAIL_POLL_NUDGE" });
}

/**
 * Build a Google Calendar add-event URL with all the event details.
 */
function buildGoogleCalendarUrl(opts: {
  title: string;
  start: Date;
  end: Date;
  location?: string | null;
  description?: string;
}): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${fmt(opts.start)}/${fmt(opts.end)}`,
  });
  if (opts.location) params.set("location", opts.location);
  if (opts.description) params.set("details", opts.description);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Build an Outlook.com add-event URL with full event details.
 */
function buildOutlookCalendarUrl(opts: {
  title: string;
  start: Date;
  end: Date;
  location?: string | null;
  description?: string;
}): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: opts.title,
    startdt: opts.start.toISOString(),
    enddt: opts.end.toISOString(),
  });
  if (opts.location) params.set("location", opts.location);
  if (opts.description) params.set("body", opts.description);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * Email fallback for when a poll owner manually settles on a date (via the
 * "Choose a date" flow) — possibly before everyone has voted.
 */
export async function sendPollSettledEmail(opts: {
  userId: string;
  fromName: string;
  eventTitle: string;
  dateStr: string;
  venue?: string | null;
  startTime: Date;
  endTime: Date;
}): Promise<boolean> {
  const subject = `${opts.eventTitle} is set for ${opts.dateStr}`;
  const description = `${opts.fromName} confirmed this hangout via Slotted.ai.`;
  const googleUrl = buildGoogleCalendarUrl({
    title: opts.eventTitle,
    start: opts.startTime,
    end: opts.endTime,
    location: opts.venue,
    description,
  });
  const outlookUrl = buildOutlookCalendarUrl({
    title: opts.eventTitle,
    start: opts.startTime,
    end: opts.endTime,
    location: opts.venue,
    description,
  });
  const venueLine = opts.venue ? `📍 ${opts.venue}\n` : "";
  const body =
    `${opts.fromName} confirmed plans for ${opts.eventTitle}:\n\n` +
    `📅 ${opts.dateStr}\n` +
    venueLine +
    "\nAdd to your calendar:\n" +
    `  • Google: ${googleUrl}\n` +
    `  • Outlook: ${outlookUrl}\n` +
    "\nOr open Slotted.ai to manage all your plans:\n" +
    "https://slotted-ai.web.app\n\n" +
    "— Slotted.ai";
  return sendEmail({ userId: opts.userId, subject, body, logTag: "EMAIL_POLL_SETTLED" });
}

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

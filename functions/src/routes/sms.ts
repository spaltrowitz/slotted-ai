import express, { Request, Response } from "express";
import { getSupabase } from "../supabase";
import { sendSMS, getPendingSMSAction, SMS_TEMPLATES, formatSMSDate } from "../utils/sms";
import { sendEngagementSMS } from "../utils/smsEngagement";
import { getDbUserById } from "../utils/helpers";
import { rateLimitPublic, getClientIp } from "../middleware/rateLimiter";

const router = express.Router();

function publicRateLimit(req: Request, res: Response, next: express.NextFunction): void {
  const ip = getClientIp(req);
  if (rateLimitPublic(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
}

/** POST /sms/inbound — ClickSend webhook for incoming SMS */
router.post("/sms/inbound", publicRateLimit, async (req: Request, res: Response) => {
  try {
    const from = req.body.from || req.body.from_number || "";
    const body = (req.body.body || req.body.message || "").trim().toUpperCase();

    if (!from || !body) {
      res.json({ success: true });
      return;
    }

    if (body === "STOP" || body === "UNSUBSCRIBE") {
      await getSupabase()
        .from("sms_opt_outs")
        .upsert({ phone_number: from, opted_out_at: new Date().toISOString() }, { onConflict: "phone_number" });
      await sendSMS(from, "You've been unsubscribed from Slotted texts. Reply START to re-subscribe anytime.");
      res.json({ success: true });
      return;
    }

    if (body === "START") {
      await getSupabase()
        .from("sms_opt_outs")
        .delete()
        .eq("phone_number", from);
      await sendSMS(from, "Welcome back! You'll receive Slotted notifications via text again. 📅");
      res.json({ success: true });
      return;
    }

    const action = await getPendingSMSAction(from);
    if (!action) {
      await sendSMS(from, "📅 Slotted here! Visit slotted-ai.web.app to manage your plans. Reply STOP to unsubscribe.");
      res.json({ success: true });
      return;
    }

    const reply = body.trim();

    switch (action.action_type) {
      case "friend_request": {
        const { friendshipId, fromUserId } = action.action_data;
        if (reply === "1") {
          await getSupabase()
            .from("friendships")
            .update({ status: "accepted" })
            .eq("id", friendshipId);
          const fromUser = await getDbUserById(fromUserId);
          await sendSMS(from, `✅ You and ${fromUser?.display_name?.split(" ")[0] || "your friend"} are connected! We'll text you when there's a good time to hang.`);
        } else {
          await sendSMS(from, "No worries! 👋");
        }
        break;
      }

      case "meetup_proposal": {
        const { meetupId, notificationId } = action.action_data;
        if (reply === "1") {
          await getSupabase()
            .from("meetup_participants")
            .update({ rsvp: "accepted" })
            .eq("meetup_id", meetupId)
            .eq("user_id", action.user_id);
          const { data: meetup } = await getSupabase()
            .from("meetups").select("title, start_time").eq("id", meetupId).maybeSingle();
          if (meetup) {
            await sendSMS(from, SMS_TEMPLATES.meetupConfirmed(meetup.title, formatSMSDate(meetup.start_time)));
          }
        } else if (reply === "2") {
          await sendSMS(from, "Open Slotted to suggest another time: slotted-ai.web.app");
        } else if (reply === "3") {
          await getSupabase()
            .from("meetup_participants")
            .update({ rsvp: "declined" })
            .eq("meetup_id", meetupId)
            .eq("user_id", action.user_id);
          await sendSMS(from, "No worries — not this time! 👋");
        }
        if (notificationId) {
          await getSupabase().from("notifications").update({ read: true }).eq("id", notificationId);
        }
        break;
      }

      case "reminder": {
        const { meetupId: remMeetupId } = action.action_data;
        if (reply === "1") {
          await sendSMS(from, "✅ See you there!");
        } else if (reply === "2") {
          await getSupabase()
            .from("meetup_participants")
            .update({ rsvp: "declined" })
            .eq("meetup_id", remMeetupId)
            .eq("user_id", action.user_id);
          await getSupabase()
            .from("meetups")
            .update({ status: "cancelled", cancel_reason: "something_came_up" })
            .eq("id", remMeetupId);
          await sendSMS(from, "Got it — we'll let your friend know. 💬");
        }
        break;
      }

      case "nudge": {
        if (reply === "1") {
          const { friendId, friendName } = action.action_data;
          
          // Find the best overlapping time via the availability API
          try {
            const sb = getSupabase();
            const { data: user } = await sb.from("users").select("*").eq("id", action.user_id).maybeSingle();
            const { data: friend } = await sb.from("users").select("*").eq("id", friendId).maybeSingle();
            
            if (!user || !friend) {
              await sendSMS(from, `Open Slotted to find a time with ${friendName}: slotted-ai.web.app/friends`);
              break;
            }

            // Fetch free slots for both users
            const now = new Date().toISOString();
            const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString();
            
            const [mySlots, friendSlots] = await Promise.all([
              sb.from("availability").select("start_time, end_time").eq("user_id", user.id).eq("status", "free").gte("end_time", now).lte("start_time", twoWeeks).order("start_time"),
              sb.from("availability").select("start_time, end_time").eq("user_id", friendId).eq("status", "free").gte("end_time", now).lte("start_time", twoWeeks).order("start_time"),
            ]);

            // Find first overlap ≥ 1 hour
            let bestSlot: { start: string; end: string } | null = null;
            for (const my of (mySlots.data || [])) {
              for (const fr of (friendSlots.data || [])) {
                const overlapStart = new Date(Math.max(new Date(my.start_time).getTime(), new Date(fr.start_time).getTime()));
                const overlapEnd = new Date(Math.min(new Date(my.end_time).getTime(), new Date(fr.end_time).getTime()));
                const durationMs = overlapEnd.getTime() - overlapStart.getTime();
                if (durationMs >= 60 * 60 * 1000 && overlapStart > new Date()) {
                  bestSlot = { start: overlapStart.toISOString(), end: overlapEnd.toISOString() };
                  break;
                }
              }
              if (bestSlot) break;
            }

            if (!bestSlot) {
              await sendSMS(from, `😕 No overlapping free times with ${friendName} in the next 2 weeks. Open Slotted to check: slotted-ai.web.app/friends`);
              break;
            }

            // Propose the time — cap at 1.5 hours
            const slotEnd = new Date(Math.min(new Date(bestSlot.end).getTime(), new Date(bestSlot.start).getTime() + 90 * 60000));
            const title = `Hangout with ${friendName}`;

            // Create the meetup
            const { data: meetup } = await sb.from("meetups").insert({
              title,
              start_time: bestSlot.start,
              end_time: slotEnd.toISOString(),
              status: "proposed",
              created_by: user.id,
            }).select().single();

            if (meetup) {
              // Add both participants
              await sb.from("meetup_participants").insert([
                { meetup_id: meetup.id, user_id: user.id, rsvp: "accepted" },
                { meetup_id: meetup.id, user_id: friendId, rsvp: "pending" },
              ]);

              // Notify the friend via SMS
              if (friend.phone_number) {
                const { createSMSAction: createAction } = await import("../utils/sms");
                await sendSMS(
                  friend.phone_number,
                  SMS_TEMPLATES.meetupProposal(
                    user.display_name?.split(" ")[0] || "Your friend",
                    formatSMSDate(bestSlot.start),
                    "Hangout",
                  ),
                );
                await createAction(friend.phone_number, friendId, "meetup_proposal", {
                  meetupId: meetup.id,
                  notificationId: "",
                });
              }

              // Also create in-app notification for the friend
              const { createNotification } = await import("../utils/helpers");
              await createNotification({
                userId: friendId,
                type: "meetup_request",
                title: `${user.display_name?.split(" ")[0]} wants to hang out!`,
                body: `${title} — ${formatSMSDate(bestSlot.start)}`,
                relatedUserId: user.id,
                relatedId: meetup.id,
              });

              await sendSMS(from, `📅 Done! Proposed ${title}\n${formatSMSDate(bestSlot.start)}\nWaiting for ${friendName} to respond.`);
            }
          } catch (err) {
            console.error("[SMS] Nudge auto-propose error:", err);
            await sendSMS(from, `Open Slotted to find a time with ${friendName}: slotted-ai.web.app/friends`);
          }
        }
        break;
      }

      default:
        await sendSMS(from, "📅 Visit slotted-ai.web.app to manage your plans.");
    }

    await getSupabase()
      .from("sms_pending_actions")
      .delete()
      .eq("phone_number", from)
      .eq("action_type", action.action_type);

    res.json({ success: true });
  } catch (err) {
    console.error("[SMS] Inbound processing error:", err);
    res.json({ success: true });
  }
});

/** POST /sms/send-test — test SMS delivery (admin only) */
router.post("/sms/send-test", async (req: Request, res: Response) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers["x-admin-secret"] !== adminSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { to, message } = req.body;
  const sent = await sendSMS(to, message || "Test from Slotted 📅");
  res.json({ sent });
});

/** POST /sms/beta-blast — Send invite-a-friend blast to all beta users with phone numbers */
router.post("/sms/beta-blast", async (req: Request, res: Response) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers["x-admin-secret"] !== adminSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const sb = getSupabase();

    const { data: users } = await sb
      .from("users")
      .select("id, display_name, phone_number, timezone, invite_code")
      .not("phone_number", "is", null)
      .eq("onboarded", true);

    if (!users || users.length === 0) {
      res.json({ sent: 0, skipped: 0, message: "No users with phone numbers" });
      return;
    }

    let sent = 0;
    let skipped = 0;

    for (const user of users) {
      const firstName = user.display_name?.split(" ")[0] || "there";
      const inviteUrl = user.invite_code
        ? `https://slotted-ai.web.app/invite/${user.invite_code}`
        : `https://slotted-ai.web.app?ref=${user.id}`;

      const success = await sendEngagementSMS(
        user.id,
        user.phone_number,
        user.timezone || "America/New_York",
        "beta_blast",
        `Hey ${firstName}! 👋 Thanks for being an early Slotted user. We'd love your help — invite one friend to sync schedules with: ${inviteUrl}`,
      );

      if (success) sent++;
      else skipped++;
    }

    res.json({ sent, skipped, total: users.length });
  } catch (err: any) {
    console.error("[BETA_BLAST] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

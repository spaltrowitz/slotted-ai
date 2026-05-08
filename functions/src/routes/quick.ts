import express, { Request, Response } from "express";

const router = express.Router();

/** Redirect to app with reschedule intent */
router.get("/quick/reschedule/:meetupId", (req: Request, res: Response) => {
  res.redirect(`https://slotted-ai.web.app/dashboard?reschedule=${req.params.meetupId}`);
});

/** Simple cancel confirmation page */
router.get("/quick/cancel/:meetupId", (req: Request, res: Response) => {
  const { meetupId } = req.params;
  const action = req.query.confirmed;

  if (action === "yes") {
    const token = req.query.token as string;
    if (!token) {
      res.redirect("https://slotted-ai.web.app/dashboard");
      return;
    }
    res.redirect(`https://slotted-ai.web.app/dashboard?cancel=${meetupId}`);
    return;
  }

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cancel Hangout — Slotted</title>
<style>body{font-family:system-ui;background:#faf9f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem}
.card{background:white;border-radius:1rem;padding:2rem;max-width:320px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.btn{display:inline-block;padding:.75rem 1.5rem;border-radius:.75rem;font-weight:600;font-size:.875rem;text-decoration:none;margin:.25rem}
.keep{background:white;border:1px solid #d1d5db;color:#374151}</style></head>
<body><div class="card">
<p style="font-size:2rem">😕</p>
<h2 style="margin:.5rem 0">Can't make it?</h2>
<p style="color:#6b7280;font-size:.875rem">Open Slotted to let your friend know.</p>
<a class="btn keep" href="https://slotted-ai.web.app/dashboard">Open Slotted</a>
</div></body></html>`);
});

/** Running late redirect */
router.get("/quick/status/:meetupId", (req: Request, res: Response) => {
  res.redirect(`https://slotted-ai.web.app/dashboard?status=${req.params.meetupId}&action=${req.query.action || "late"}`);
});

export default router;

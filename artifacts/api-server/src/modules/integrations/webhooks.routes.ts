import { Router, type Request, type Response } from "express";
import { ingestWebhookEvent } from "./webhookIngest.service";

const router = Router();

router.post("/:provider", async (req: Request, res: Response) => {
  const result = await ingestWebhookEvent({
    provider: String(req.params.provider),
    headers: req.headers,
    payload: req.body,
  });

  if (!result.accepted) {
    res.status(400).json({ accepted: false, reason: result.reason });
    return;
  }

  if (!result.event) {
    res.status(500).json({ accepted: false, reason: "event_not_recorded" });
    return;
  }

  res.status(result.duplicate ? 200 : 202).json({
    accepted: true,
    duplicate: result.duplicate,
    eventId: result.event.id,
    status: result.duplicate ? "ignored" : result.event.status,
  });
});

export default router;

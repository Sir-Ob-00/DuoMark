import type { RequestHandler } from "express";
import { sessionToken } from "../middleware/auth.js";
import { resolveSession } from "../services/auth.service.js";
import { developmentDeviceAuthenticator } from "../integrations/check-in.js";
import { HttpError } from "../utils/http-error.js";
import { terminalId } from "../validation/terminal.validation.js";
import { scopedNotification, subscriberActive, subscribeChanges, type EventSubscriber } from "../services/events.service.js";

export const streamEvents: RequestHandler = async (request, response) => {
  if (process.env.EVENTS_ENABLED === "false") throw new HttpError(503, "Live events are disabled");
  if (Object.keys(request.query).some(key => key !== "terminalId")) throw new HttpError(400, "Unsupported events query fields");
  let subscriber: EventSubscriber;
  if (request.get("Authorization")) {
    const authorization = request.get("Authorization")!;
    const device = await developmentDeviceAuthenticator.authenticate(authorization);
    if (device.terminalId !== terminalId(request.query.terminalId)) throw new HttpError(403, "Device is not bound to this terminal");
    subscriber = { kind: "device", authorization, deviceId: device.id, terminalId: device.terminalId };
  } else {
    if (request.query.terminalId !== undefined) throw new HttpError(401, "Device authentication required for station events");
    const token = sessionToken(request);
    const actor = token ? await resolveSession(token) : null;
    if (!actor || !token) throw new HttpError(401, "Authentication required");
    if (actor.role !== "LECTURER") throw new HttpError(403, "Forbidden");
    subscriber = { kind: "staff", token, staffId: actor.id };
  }
  response.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
  response.flushHeaders();
  let closed = false;
  let pending = 0;
  let queue = Promise.resolve();
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    response.end();
  };
  const write = (type: string, payload: object) => {
    if (!closed && !response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)) cleanup();
  };
  // Bound slow-client work and serialize auth/scope checks without blocking the
  // committing service. A DB/auth error closes the stream rather than leaking.
  const schedule = (work: () => Promise<void>) => {
    if (closed) return;
    if (++pending > 100) { cleanup(); return; }
    queue = queue.then(async () => { if (!closed) await work(); }).catch(cleanup).finally(() => { pending--; });
  };
  const unsubscribe = subscribeChanges(change => schedule(async () => {
    if (!await subscriberActive(subscriber)) { cleanup(); return; }
    if (await scopedNotification(subscriber, change)) write(change.type, { sessionId: change.sessionId });
  }));
  const heartbeat = setInterval(() => schedule(async () => {
    if (!await subscriberActive(subscriber)) { cleanup(); return; }
    if (!closed && !response.write(": heartbeat\n\n")) cleanup();
  }), 5000);
  heartbeat.unref();
  response.on("close", cleanup);
  request.on("aborted", cleanup);
  write("ready", {});
  response.write("retry: 3000\n\n");
};

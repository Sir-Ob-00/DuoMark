import { prisma } from "../db/prisma.js";
import { resolveSession } from "./auth.service.js";
import { developmentDeviceAuthenticator } from "../integrations/check-in.js";

type Change = { type: "session-opened" | "session-closed" | "attendance-recorded"; sessionId: string; terminalId: string };
type Listener = (change: Change) => void;
const listeners = new Set<Listener>();
// Process-local invalidation hints, not a durable event log. Publish only after
// awaiting the mutation transaction. Reconnect always reloads authorized state.
export function publishChange(change: Change) {
  for (const listener of listeners) {
    // A notification consumer must never turn a committed mutation into an API
    // failure. Slow/failed streams recover through authoritative reads.
    try { listener(change); } catch { /* isolated notification consumer */ }
  }
}
export function subscribeChanges(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export type EventSubscriber = { kind: "staff"; token: string; staffId: string }
  | { kind: "device"; authorization: string; deviceId: string; terminalId: string };
export async function subscriberActive(subscriber: EventSubscriber) {
  if (subscriber.kind === "staff") {
    const actor = await resolveSession(subscriber.token);
    return actor?.id === subscriber.staffId && actor.role === "LECTURER";
  }
  try {
    const device = await developmentDeviceAuthenticator.authenticate(subscriber.authorization);
    return device.id === subscriber.deviceId && device.terminalId === subscriber.terminalId;
  } catch { return false; }
}
export async function scopedNotification(subscriber: EventSubscriber, change: Change) {
  if (subscriber.kind === "device") return change.type !== "attendance-recorded" && change.terminalId === subscriber.terminalId;
  // Same original-opening-lecturer rule as session history/detail, including
  // after reassignment. Never trust a requested lecturerId or cached assignment.
  return !!await prisma.attendanceSession.findFirst({ where: { id: change.sessionId, lecturerId: subscriber.staffId }, select: { id: true } });
}

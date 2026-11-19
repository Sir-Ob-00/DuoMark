import type { RequestHandler } from "express";
import { developmentDeviceAuthenticator, type DevicePrincipal } from "../integrations/check-in.js";
import { terminalId } from "../validation/terminal.validation.js";
import { HttpError } from "../utils/http-error.js";

declare global { namespace Express { interface Request { device?: DevicePrincipal } } }
export const requireCheckInDevice: RequestHandler = async (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  const device = await developmentDeviceAuthenticator.authenticate(request.get("Authorization"));
  if (device.terminalId !== terminalId(request.params.terminalId)) throw new HttpError(403, "Device is not bound to this terminal");
  request.device = device;
  next();
};

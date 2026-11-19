// Neither trusted provisioning/redemption nor invitation delivery exists here.
// Fail closed in every environment. No environment flag can enable sending.
export const invitationAvailability = Object.freeze({
  provisioningConfigured: false,
  deliveryConfigured: false,
  message: "Lecturer invitations unavailable: trusted account provisioning and invitation delivery are not configured",
} as const);

import type { ConfigService } from "@nestjs/config";

/** The customer's appointment page — linked from the booked and reminder notifications. */
export function appointmentManageUrl(config: ConfigService, publicToken: string): string {
  const base = config.get<string>("WEB_APP_URL") ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/appointment/${publicToken}`;
}

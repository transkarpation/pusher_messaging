/** VAPID details Web Push is sent with. */
export interface WebPushConfig {
  /** A `mailto:` or `https:` contact the push services can reach the sender at. */
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Web Push from WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY / WEB_PUSH_SUBJECT, or null (Web
 * Push off) when the keys aren't set. Generate a pair with `pnpm --filter server push:keys`.
 */
export function webPushConfigFromEnv(): WebPushConfig | null {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.WEB_PUSH_SUBJECT || "mailto:admin@localhost" };
}

/** EXPO_ACCESS_TOKEN, for Expo projects with "enhanced push security" on. */
export const expoAccessTokenFromEnv = (): string | undefined => process.env.EXPO_ACCESS_TOKEN || undefined;

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  /**
   * The Kairema owner's account email. This is the authoritative owner identity and the only
   * claim that can grant owner or admin access; it is compared server-side against the
   * authenticated user's own email. It is never sent to the client, so a visitor cannot learn it
   * from the bundle, and an unset value grants nothing.
   */
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  /**
   * Legacy owner claim, kept so an existing deployment keeps working. It is no longer sufficient on
   * its own: when set it must resolve to the same account as `OWNER_EMAIL`, so it can never hand
   * owner access to a different person. It may be left unset entirely.
   */
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  b2Endpoint: process.env.B2_ENDPOINT ?? "",
  b2Region: process.env.B2_REGION ?? "",
  b2Bucket: process.env.B2_BUCKET ?? "",
  b2KeyId: process.env.B2_KEY_ID ?? "",
  b2ApplicationKey: process.env.B2_APPLICATION_KEY ?? "",
};

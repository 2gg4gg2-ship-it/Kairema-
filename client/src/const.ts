export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Start the independent Stytch login flow. Navigates to the built-in welcome
// page where the user can request a magic link or use email/password.
export const startLogin = () => {
  window.location.assign("/welcome");
};

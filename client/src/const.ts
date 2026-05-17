export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL at runtime so redirect URI reflects the current origin.
// Pass returnPath to store in a cookie before redirecting to login.
export const getLoginUrl = (returnPath?: string) => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  // State MUST be plain base64 redirectUri for the Manus OAuth SDK
  const state = btoa(redirectUri);
  // Store returnPath in a cookie so the callback can redirect there after login
  if (returnPath && typeof document !== 'undefined') {
    document.cookie = `espn_return_path=${encodeURIComponent(returnPath)};path=/;max-age=300;SameSite=Lax`;
  }
  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");
  return url.toString();
};

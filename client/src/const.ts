import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Start the Manus OAuth login. Call this from an event handler or effect at the
// moment you want to navigate. Configuration is checked before navigation so
// a broken Vercel environment shows a useful message instead of silently doing nothing.
export const startLogin = () => {
  const oauthPortalUrl = String(import.meta.env.VITE_OAUTH_PORTAL_URL ?? "").trim();
  const appId = String(import.meta.env.VITE_APP_ID ?? "").trim();

  if (!oauthPortalUrl) {
    throw new Error("Alamat login Manus belum dikonfigurasi di Vercel (VITE_OAUTH_PORTAL_URL).");
  }

  if (!appId) {
    throw new Error("ID aplikasi Gudang IR belum dikonfigurasi di Vercel (VITE_APP_ID).");
  }

  let portal: URL;
  try {
    portal = new URL(oauthPortalUrl);
  } catch {
    throw new Error("Alamat login Manus tidak valid. Periksa VITE_OAUTH_PORTAL_URL di Vercel.");
  }

  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const nonce = crypto.randomUUID();

  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
  const state = encodeOAuthState({ redirectUri, nonce });

  portal.pathname = "/app-auth";
  portal.search = "";
  portal.searchParams.set("appId", appId);
  portal.searchParams.set("redirectUri", redirectUri);
  portal.searchParams.set("state", state);
  portal.searchParams.set("type", "signIn");

  console.info("[Login] Redirecting to Manus OAuth", {
    redirectUri,
    portal: portal.origin,
  });

  window.location.href = portal.toString();
};

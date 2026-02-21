import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { exchangeCodeForTokens, saveGoogleAuth } from "../services/google-calendar.server";

/**
 * Google OAuth callback handler
 * This route receives the authorization code from Google after user consent
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // Contains the shop domain
  const error = url.searchParams.get("error");

  if (error) {
    console.error("Google OAuth error:", error);
    return redirect(`/app/settings/google-calendar?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return redirect("/app/settings/google-calendar?error=Missing+authorization+code");
  }

  const shop = state;

  try {
    // Exchange the code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Save the tokens
    await saveGoogleAuth(shop, tokens);

    return redirect("/app/settings/google-calendar?success=true");
  } catch (err) {
    console.error("Failed to complete Google OAuth:", err);
    return redirect(
      `/app/settings/google-calendar?error=${encodeURIComponent("Failed to connect Google Calendar")}`
    );
  }
};

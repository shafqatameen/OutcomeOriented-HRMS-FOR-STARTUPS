"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getGoogleSignInUrl, login } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogIn } from "lucide-react";

/**
 * What went wrong on the way back from Google, in words.
 *
 * The callback cannot render anything itself — it is a browser navigation that
 * ends in a redirect — so it puts a short code in the query string and this
 * table turns it into a sentence. Codes rather than messages because a message
 * passed through a URL is a message anybody can put on this page.
 */
const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  expired: "That Google sign-in attempt expired. Try again.",
  unconfigured: "Google sign-in is not set up on this server.",
  exchange_failed: "Google could not be reached. Try again in a moment.",
  identity_rejected:
    "Google did not confirm that address. Make sure the account's email is verified.",
  deactivated: "That account has been deactivated. Ask an administrator to restore it.",
};

/**
 * The sign-in card, split out of the page when that page grew a description of
 * the app around it. The page is a Server Component now — the copy beside this
 * form is static and belongs in the first HTML response — and `metadata` cannot
 * be exported from a Client Component, so the interactive half lives here.
 */
export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleUrl, setGoogleUrl] = useState<string | null>(null);

  useEffect(() => {
    // Read straight off the URL rather than through useSearchParams: this page
    // is already a Client Component, and the hook would additionally require a
    // Suspense boundary around it.
    //
    // The obvious tidier fix — resolve `google_error` on the server and pass it
    // down — is rejected on purpose. Touching `searchParams` in the page would
    // opt the whole route out of static rendering, and this route is the app's
    // only indexable page: keeping it prerendered is worth more than avoiding
    // one mount-time setState on a rare OAuth failure path.
    const code = new URLSearchParams(window.location.search).get("google_error");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (code) setError(GOOGLE_ERRORS[code] ?? "Google sign-in did not work.");

    // Null on a server with no Google credentials, in which case no button is
    // offered rather than one that leads to Google's own error page.
    getGoogleSignInUrl()
      .then((start) => setGoogleUrl(start.authorization_url))
      .catch(() => setGoogleUrl(null));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      window.location.href = user.role === "Admin" ? "/admin" : "/";
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Login failed");
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <Input
              id="email"
              // Deliberately text, not email. Accounts predating email sign-in
              // still identify by name, and type="email" would have the browser
              // refuse to submit one before the API ever sees it — locking out
              // exactly the accounts the fallback exists for. The API validates.
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <div role="alert" className="text-sm text-destructive">
              {error}
            </div>
          )}
          <Button type="submit" disabled={submitting} className="flex gap-2">
            <LogIn className="w-4 h-4" />
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        {googleUrl && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            {/*
              A plain anchor, not a fetch. This is a full-page navigation to
              Google's consent screen and back, and the session cookie is set
              on the redirect that ends it — an XHR could not carry either half.
            */}
            <Button
              render={<a href={googleUrl} />}
              variant="outline"
              className="w-full gap-2"
            >
              <GoogleMark />
              Continue with Google
            </Button>
          </>
        )}

        <div className="mt-4 space-y-1 text-sm">
          <p>
            <Link
              href="/forgot-password"
              className="text-primary underline-offset-4 hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
          <p className="text-muted-foreground">
            No account?{" "}
            <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Google's mark, inline so the button needs no network request to render. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.5 5.5 0 0 1-2.4 3.6v3h3.88c2.27-2.09 3.57-5.17 3.57-8.63z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.9l-3.88-3c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.3a7.2 7.2 0 0 1 0-4.6V6.61H1.28a12 12 0 0 0 0 10.78l3.99-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

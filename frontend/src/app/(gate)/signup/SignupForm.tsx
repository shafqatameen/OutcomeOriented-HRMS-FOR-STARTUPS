"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSignupStatus, signup, type SignupStatus } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MailCheck, UserPlus } from "lucide-react";

/**
 * Asks for an address, and nothing else that matters.
 *
 * There is deliberately no password field. The address is confirmed first and
 * the password is chosen on the page the mailed link opens, which means a
 * password is only ever stored for a mailbox somebody has shown they can read.
 *
 * The success state is the same whether or not the address was already
 * registered, because the API answers the same either way — see the note in
 * lib/api.ts. Do not add a "that address is taken" message here; there is no
 * way for this component to know, by design.
 */
export function SignupForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<SignupStatus | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // A server with no SMTP settings cannot finish a sign-up, so the form is
    // never shown on one. Filling it in and getting a 503 teaches nobody
    // anything they could act on.
    getSignupStatus()
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, mail_ready: false }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(email, name.trim() || undefined);
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Could not sign up");
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailCheck className="h-4 w-4" />
            Check your inbox
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            If that address can be used here, we have sent it a link. Follow it to confirm
            the address and choose a password.
          </p>
          <p className="text-muted-foreground">
            The link works for 24 hours. If nothing arrives, check the spam folder before
            trying again.
          </p>
          <p>
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status && (!status.enabled || !status.mail_ready)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign-up is closed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            {status.enabled
              ? "This server cannot send email yet, so accounts cannot be confirmed."
              : "This site is not accepting new accounts."}{" "}
            Ask an administrator to create one for you.
          </p>
          <p>
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Your name <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="How colleagues should see you"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" disabled={submitting || !status} className="flex gap-2">
            <UserPlus className="h-4 w-4" />
            {submitting ? "Sending..." : "Send me a link"}
          </Button>

          <p className="text-sm text-muted-foreground">
            New accounts need an administrator&apos;s approval before they can be used.
          </p>

          <p className="text-sm">
            Already have an account?{" "}
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

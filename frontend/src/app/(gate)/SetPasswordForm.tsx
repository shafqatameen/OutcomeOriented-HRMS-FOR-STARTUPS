"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  checkToken,
  resetPassword,
  verifyEmail,
  type SetPasswordResult,
  type TokenPurpose,
} from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  PasswordFields,
  passwordReady,
  type PasswordState,
} from "@/components/PasswordFields";
import { CheckCircle2, KeyRound, Link2Off } from "lucide-react";

/**
 * The set-a-password page, used by both /verify and /reset-password.
 *
 * One component because the two differ only in wording and in which endpoint
 * they post to. Everything that could go wrong — a link that was already used,
 * an account still waiting for approval — is identical, and duplicating it
 * would mean fixing every such case twice.
 *
 * The link is checked before the form renders, and that check deliberately does
 * not spend it: mail scanners open links before people do, so a page that
 * consumed the token just by loading would break for exactly the people whose
 * IT department protects them best.
 */
export function SetPasswordForm({
  token,
  purpose,
  heading,
  intro,
}: {
  token: string;
  purpose: TokenPurpose;
  heading: string;
  intro: string;
}) {
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [state, setState] = useState<PasswordState>({ password: "", confirm: "" });
  const [result, setResult] = useState<SetPasswordResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    checkToken(token, purpose)
      .then((check) => {
        setValid(check.valid);
        setAddress(check.email);
      })
      .catch(() => setValid(false))
      .finally(() => setChecking(false));
  }, [token, purpose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const call = purpose === "verify_email" ? verifyEmail : resetPassword;
      setResult(await call(token, state.password, state.confirm));
    } catch (err: any) {
      setError(err.message || "Could not set your password");
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Checking your link...
        </CardContent>
      </Card>
    );
  }

  if (!valid) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2Off className="h-4 w-4" />
            This link no longer works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            It has either expired or already been used. Links can only be used once, so
            this is what a second visit to the same one looks like.
          </p>
          <p>
            <Link
              href={purpose === "verify_email" ? "/signup" : "/forgot-password"}
              className="text-primary underline-offset-4 hover:underline"
            >
              Ask for a new link
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (result) {
    // `signed_in` means a session cookie came back with the response, so there
    // is nothing left to type — anything else needs a sentence and a way out.
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {result.status === "pending" ? "Almost there" : "Password set"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{result.message}</p>
          {result.status === "signed_in" ? (
            <Button onClick={() => (window.location.href = "/")}>Go to the app</Button>
          ) : (
            <p>
              <Link href="/login" className="text-primary underline-offset-4 hover:underline">
                Back to sign in
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {intro}
            {address && (
              <>
                {" "}
                This link is for <span className="font-medium text-foreground">{address}</span>.
              </>
            )}
          </p>

          <PasswordFields value={state} onChange={setState} disabled={submitting} />

          {error && (
            <div role="alert" className="text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting || !passwordReady(state)}
            className="flex gap-2"
          >
            <KeyRound className="h-4 w-4" />
            {submitting ? "Saving..." : "Save password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

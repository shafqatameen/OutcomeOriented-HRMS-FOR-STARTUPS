"use client";
import { useState } from "react";
import Link from "next/link";
import { forgotPassword } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MailCheck, Send } from "lucide-react";

/**
 * Asks where to send a reset link.
 *
 * The confirmation below is shown for every address, registered or not, because
 * that is all the API will tell this page. Anything more specific would let
 * anyone check whether a colleague has an account here by typing their work
 * address into a form that requires no login.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err: any) {
      // Reached by the rate limiter, essentially. A genuine failure to send is
      // deliberately invisible here.
      setError(err.message || "Could not send the link");
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
            If that address can be used here, we have sent it a link for choosing a new
            password. It works for one hour.
          </p>
          <p className="text-muted-foreground">
            Your current password still works until you use the link.
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
        <CardTitle>Forgot your password?</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the address you sign in with and we will send you a link to set a new
            password.
          </p>

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

          {error && (
            <div role="alert" className="text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" disabled={submitting} className="flex gap-2">
            <Send className="h-4 w-4" />
            {submitting ? "Sending..." : "Send reset link"}
          </Button>

          <p className="text-sm">
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

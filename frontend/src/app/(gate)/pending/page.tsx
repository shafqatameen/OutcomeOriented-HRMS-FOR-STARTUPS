import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Hourglass } from "lucide-react";

export const metadata = { title: "Waiting for approval" };

/**
 * Where the Google callback sends someone whose account is not approved yet.
 *
 * Worth a page of its own rather than a query parameter on /login. Being told
 * "waiting for approval" on the same screen as a sign-in form reads as a
 * failure to sign in, and people retype their password at it.
 */
export default function PendingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Almost there</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hourglass className="h-4 w-4" />
            Waiting for approval
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Your address is confirmed. An administrator has to approve the account before
            you can sign in — you will get an email when that happens.
          </p>
          <p className="text-muted-foreground">
            Nothing else is needed from you, and signing in again will not speed it up.
          </p>
          <p>
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

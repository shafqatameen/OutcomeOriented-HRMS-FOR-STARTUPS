"use client";
import { useCallback, useEffect, useState } from "react";
import { approveUser, getPendingUsers, type PendingUser } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserCheck } from "lucide-react";

/**
 * People who signed themselves up, confirmed their address, and are waiting.
 *
 * Renders nothing at all when the queue is empty. A permanently visible
 * "0 pending" card is a thing an administrator learns to stop seeing, and this
 * has to catch the eye on the rare day something is in it.
 *
 * Unverified sign-ups never appear — the API filters them out. Anyone can type
 * a stranger's address into the sign-up form, so a queue that listed those
 * would be a queue of other people's typos and would stop being worth reading.
 */
export function PendingApprovals({ onApproved }: { onApproved: () => void }) {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<number | null>(null);

  const load = useCallback(() => {
    getPendingUsers()
      .then(setPending)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load pending accounts"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (person: PendingUser) => {
    setError(null);
    setWorking(person.id);
    try {
      await approveUser(person.id);
      load();
      // The approved account is now an ordinary one, so the list below and the
      // rest of the shell both have to be told.
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve this account");
    } finally {
      setWorking(null);
    }
  };

  if (pending.length === 0 && !error) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Waiting for approval
          {pending.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {pending.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <p className="text-sm text-muted-foreground">
          These people confirmed their email address and cannot sign in until you approve
          them. Approving grants the same starting access as a new account you create
          here.
        </p>

        {pending.map((person) => (
          <div
            key={person.id}
            className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{person.name}</p>
              <p className="truncate text-xs text-muted-foreground">{person.email}</p>
            </div>
            <Button
              size="sm"
              onClick={() => handleApprove(person)}
              disabled={working === person.id}
              className="flex shrink-0 gap-1.5"
            >
              <UserCheck className="h-3.5 w-3.5" />
              {working === person.id ? "Approving..." : "Approve"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

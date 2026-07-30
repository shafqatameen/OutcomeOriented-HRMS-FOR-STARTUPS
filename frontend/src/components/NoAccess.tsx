import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import ContextHeader from "@/components/ContextHeader";

/**
 * Shown instead of a page the session lacks access to. Rendered rather than
 * redirected, because redirecting someone who also lacks the destination's
 * permission would loop.
 */
export default function NoAccess({ feature }: { feature: string }) {
  return (
    <div className="space-y-6">
      <ContextHeader title={feature} />
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
          <Lock className="h-6 w-6 text-muted-foreground" />
          <div className="font-semibold">You do not have access to {feature}</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            An administrator can grant it from Admin → Access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatAmount, formatShare, pillarFill, pillarInk, type Panel } from "@/lib/panel";

/**
 * The sub-domain level: which function inside each pillar the work landed in.
 *
 * A pillar is too coarse to act on — "58% Business" tells you nothing you can
 * change on Monday, while "most of it was Finance, not IT" does. The seat is
 * marked here rather than only on its own card, because this is the table where
 * you can see it next to everything competing with it.
 */
export default function FunctionBreakdown({ panel }: { panel: Panel }) {
  const { functions, unit, seat } = panel;

  if (functions.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          By function
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pillar › Function</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">
                  {unit === "minutes" ? "Time" : "Points"}
                </TableHead>
                <TableHead className="text-right">Done</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {functions.map((row) => {
                const isSeat = seat?.function_id === row.function_id;
                return (
                  <TableRow key={row.function_id}>
                    <TableCell>
                      <span
                        className="flex items-center gap-2 border-l-[3px] pl-2"
                        style={{ borderColor: pillarInk(row.pillar_slug) }}
                      >
                        <span
                          aria-hidden
                          className="inline-block size-2.5 shrink-0 rounded-[2px] ring-1 ring-foreground/20"
                          style={{ background: pillarFill(row.pillar_slug) }}
                        />
                        <span className="text-muted-foreground">
                          {row.pillar_name.replace(/ Pillar$/, "")} ›
                        </span>
                        <span className="font-medium">{row.name}</span>
                        {isSeat && (
                          <span className="text-xs font-semibold text-primary">
                            your seat
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatShare(row.share)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAmount(row, unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.completed_tasks}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.open_tasks}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

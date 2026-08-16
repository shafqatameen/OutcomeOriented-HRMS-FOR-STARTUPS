"use client";

import { useEffect, useMemo, useState } from "react";
import { getPermissionCatalogue, getUserAccess, setUserAccess } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Check, Loader2 } from "lucide-react";

type PermissionInfo = { key: string; label: string; group: string; description: string };
type UserAccess = {
  user_id: number;
  name: string;
  role: string;
  is_admin: boolean;
  effective_permissions: string[];
  granted_permissions: string[];
};

export default function AccessForm() {
  const [catalogue, setCatalogue] = useState<PermissionInfo[]>([]);
  const [rows, setRows] = useState<UserAccess[]>([]);
  /** Unsaved edits, keyed by user id. Absent means untouched. */
  const [draft, setDraft] = useState<Record<number, string[]>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getUserAccess().then(setRows).catch((e) => setError(e.message));
    getPermissionCatalogue().then(setCatalogue).catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const groups = useMemo(() => {
    const out: { group: string; items: PermissionInfo[] }[] = [];
    for (const item of catalogue) {
      const existing = out.find((g) => g.group === item.group);
      if (existing) existing.items.push(item);
      else out.push({ group: item.group, items: [item] });
    }
    return out;
  }, [catalogue]);

  const selectionFor = (row: UserAccess) => draft[row.user_id] ?? row.granted_permissions;
  const isDirty = (row: UserAccess) =>
    draft[row.user_id] !== undefined &&
    [...draft[row.user_id]].sort().join() !== [...row.granted_permissions].sort().join();

  const toggle = (row: UserAccess, key: string) => {
    const current = selectionFor(row);
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    setDraft((d) => ({ ...d, [row.user_id]: next }));
    setSavedAt((s) => ({ ...s, [row.user_id]: false }));
  };

  const save = async (row: UserAccess) => {
    setSaving(row.user_id);
    setError(null);
    try {
      await setUserAccess(row.user_id, selectionFor(row));
      setDraft((d) => {
        const next = { ...d };
        delete next[row.user_id];
        return next;
      });
      setSavedAt((s) => ({ ...s, [row.user_id]: true }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save access");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-destructive/50 p-3 text-sm text-destructive">{error}</div>
      )}

      <p className="text-sm text-muted-foreground">
        Tick a feature to grant it. Changes take effect the next time that person loads a
        page. Every one of these is enforced by the API, not just hidden in the interface.
      </p>

      {rows.map((row) => {
        const selection = selectionFor(row);
        const dirty = isDirty(row);
        return (
          <Card key={row.user_id}>
            <CardHeader className="flex flex-row flex-wrap items-center gap-2">
              <CardTitle>{row.name.toUpperCase()}</CardTitle>
              {row.is_admin ? (
                <Badge variant="outline" className="flex items-center gap-1 text-primary">
                  <ShieldCheck className="h-3 w-3" />
                  Admin — full access
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  {row.role}
                </Badge>
              )}
              <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                {savedAt[row.user_id] && !dirty && (
                  <span className="flex items-center gap-1 text-success">
                    <Check className="h-3 w-3" /> Saved
                  </span>
                )}
                {row.is_admin
                  ? "bypasses all checks"
                  : `${row.effective_permissions.length} of ${catalogue.length} features`}
              </span>
            </CardHeader>

            <CardContent className="space-y-4">
              {row.is_admin && (
                <div className="rounded border bg-muted/40 p-3 text-sm text-muted-foreground">
                  The Admin role bypasses every permission check, so these boxes do not
                  restrict this account. Change the role to Member to make them apply — that
                  is also what stops you locking yourself out of this page.
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {groups.map((group) => (
                  <div key={group.group} className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                      {group.group}
                    </div>
                    {group.items.map((item) => (
                      <label
                        key={item.key}
                        className="flex cursor-pointer items-start gap-2 text-sm"
                        title={item.description}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selection.includes(item.key)}
                          disabled={row.is_admin}
                          onChange={() => toggle(row, item.key)}
                        />
                        <span className={row.is_admin ? "text-muted-foreground" : undefined}>
                          {item.label}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>

              {!row.is_admin && (
                <div className="flex items-center gap-3">
                  <Button onClick={() => save(row)} disabled={!dirty || saving === row.user_id}>
                    {saving === row.user_id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save access
                  </Button>
                  {dirty && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((d) => {
                          const next = { ...d };
                          delete next[row.user_id];
                          return next;
                        })
                      }
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Discard changes
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

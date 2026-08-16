"use client";
import { Input } from "@/components/ui/input";

/**
 * The password-and-confirm pair, shared by the two pages that set a password.
 *
 * Shared rather than written twice so the rules cannot drift apart: /verify and
 * /reset-password are the same form with a different heading, and a minimum
 * length enforced on one page but not the other is the kind of difference
 * nobody notices until somebody is locked out.
 *
 * These checks are a courtesy, not the enforcement. The API validates both the
 * length and the match again, because anything decided only in a browser is
 * decided by whoever is using the browser.
 */

/** Kept in step with the API's own minimum in auth/passwords.py. */
export const MIN_PASSWORD_LENGTH = 12;

export type PasswordState = { password: string; confirm: string };

/**
 * The reason this pair is not yet acceptable, or null when it is.
 *
 * Returns null while the confirmation is still empty rather than complaining
 * that it does not match — nagging about a mismatch before somebody has
 * finished the first keystroke of the second field is noise, not help.
 */
export const passwordProblem = ({ password, confirm }: PasswordState): string | null => {
  if (password.length > 0 && password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (confirm.length > 0 && password !== confirm) {
    return "The two passwords do not match.";
  }
  return null;
};

/** Whether the form may be submitted at all. */
export const passwordReady = (state: PasswordState): boolean =>
  state.password.length >= MIN_PASSWORD_LENGTH && state.password === state.confirm;

export function PasswordFields({
  value,
  onChange,
  disabled,
}: {
  value: PasswordState;
  onChange: (next: PasswordState) => void;
  disabled?: boolean;
}) {
  const problem = passwordProblem(value);

  return (
    <>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <Input
          id="password"
          type="password"
          // "new-password" rather than "current-password" is what tells a
          // password manager to offer to generate and save one here.
          autoComplete="new-password"
          value={value.password}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
          disabled={disabled}
          required
        />
        <p className="mt-1 text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters. A phrase of a few words is easier to
          remember and harder to guess than a short one with symbols in it.
        </p>
      </div>

      <div>
        <label htmlFor="password-confirm" className="mb-1 block text-sm font-medium">
          Confirm password
        </label>
        <Input
          id="password-confirm"
          type="password"
          autoComplete="new-password"
          value={value.confirm}
          onChange={(e) => onChange({ ...value, confirm: e.target.value })}
          disabled={disabled}
          aria-invalid={problem !== null}
          required
        />
      </div>

      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </>
  );
}

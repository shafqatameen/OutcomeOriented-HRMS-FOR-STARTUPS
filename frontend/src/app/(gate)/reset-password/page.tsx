import { SetPasswordForm } from "../SetPasswordForm";

export const metadata = { title: "Reset your password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await searchParams).token;
  const token = Array.isArray(raw) ? raw[0] : (raw ?? "");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reset your password</h1>
      <SetPasswordForm
        token={token}
        purpose="password_reset"
        heading="Choose a new password"
        intro="Whoever knew the old password will not be able to sign in with it after this."
      />
    </div>
  );
}

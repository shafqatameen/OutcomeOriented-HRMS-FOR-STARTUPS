import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Forgot your password" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Password reset</h1>
      <ForgotPasswordForm />
    </div>
  );
}

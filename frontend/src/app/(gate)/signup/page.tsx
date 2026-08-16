import { SignupForm } from "./SignupForm";

export const metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sign up</h1>
      <SignupForm />
    </div>
  );
}

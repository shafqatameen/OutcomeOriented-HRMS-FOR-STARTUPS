import { SetPasswordForm } from "../SetPasswordForm";

export const metadata = { title: "Confirm your address" };

/**
 * Where the verification email lands.
 *
 * A Server Component reading `searchParams` rather than a client one calling
 * `useSearchParams`: the hook forces everything up to the nearest Suspense
 * boundary to be client-rendered, and passing the token down as a prop avoids
 * needing a boundary here at all.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await searchParams).token;
  // Arrays happen when a link is somehow duplicated in the query string. Taking
  // the first is the same thing the API would do with it.
  const token = Array.isArray(raw) ? raw[0] : (raw ?? "");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Confirm your address</h1>
      <SetPasswordForm
        token={token}
        purpose="verify_email"
        heading="Choose a password"
        intro="Your address is confirmed once you save a password."
      />
    </div>
  );
}

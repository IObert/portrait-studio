import Link from "next/link";
import { Mark } from "../admin/_components/ui";
import { SignOut } from "./sign-out";

export const metadata = { title: "Signed out · Portrait Studio", robots: { index: false, follow: false } };

/** Public on purpose (outside the proxy matcher): it has to render after the admin login is dropped. */
export default function LogoutPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-ink px-6 text-center text-white">
      <Mark className="h-12" />
      <SignOut />
      <Link href="/admin" className="rounded-lg bg-signal px-5 py-2.5 text-sm font-semibold text-white hover:bg-signal-2 focus-visible:outline-white">
        Sign in again
      </Link>
    </main>
  );
}

import Link from "next/link";
import { EmptyPrint } from "./admin/_components/ui";

export const metadata = { title: "Not found · Portrait Studio" };

/** App-wide 404: an empty print, because the thing you were looking for didn't develop. */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 bg-ink px-6 py-16 text-center text-white">
      <EmptyPrint onDark />
      <div className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">This one didn&rsquo;t develop</h1>
        <p className="mx-auto max-w-sm text-white/70">There&rsquo;s nothing at this address. The link may be mistyped, or the page was removed.</p>
      </div>
      <Link href="/" className="rounded-lg border border-white/30 px-5 py-2.5 text-sm font-semibold hover:bg-white/10 focus-visible:outline-white">
        Go to the start page
      </Link>
    </main>
  );
}

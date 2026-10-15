import Link from "next/link";
import { Mark } from "./admin/_components/ui";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 bg-ink px-6 py-16 text-center text-white">
      <Mark className="h-24 drop-shadow-[0_12px_30px_rgb(239_34_58/0.35)] sm:h-28" />
      <div className="space-y-3">
        <h1 className="font-display text-5xl font-semibold tracking-tight sm:text-7xl">Portrait Studio</h1>
        <p className="mx-auto max-w-md text-lg text-white/70">AI portraits at the booth, delivered over Twilio Messaging.</p>
      </div>
      <Link href="/admin" className="rounded-lg bg-signal px-6 py-3 font-semibold text-white transition-colors hover:bg-signal-2 focus-visible:outline-white">
        Sign in to the admin
      </Link>
    </main>
  );
}

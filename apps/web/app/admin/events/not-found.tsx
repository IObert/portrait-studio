import Link from "next/link";
import { btn, EmptyPrint } from "../_components/ui";

export default function EventNotFound() {
  return (
    <div className="flex flex-col items-center gap-8 py-12 text-center">
      <EmptyPrint />
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">404: event could not be found</h1>
        <p className="mx-auto max-w-sm text-slate">It may have been deleted, or the event code in the address is wrong.</p>
      </div>
      <Link href="/admin" className={`${btn.base} ${btn.secondary}`}>
        Back to events
      </Link>
    </div>
  );
}

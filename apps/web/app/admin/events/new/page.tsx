import Link from "next/link";
import { Suspense } from "react";
import { createEventAction } from "@/lib/admin/actions";
import { requireAdmin } from "@/lib/admin/guard";
import { formOptions, senderOptions } from "@/lib/admin/options";
import { defaultConfig } from "@/lib/events/schema";
import { EventForm } from "../../_components/event-form";

export const metadata = { title: "New event · Portrait Studio" };

async function NewEventForm() {
  await requireAdmin();
  return <EventForm action={createEventAction} config={defaultConfig("", "")} {...formOptions()} senders={await senderOptions()} submitLabel="Create event" />;
}

export default function NewEventPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 space-y-2">
        <Link href="/admin" className="text-sm text-slate hover:text-ink">
          Events
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight">New event</h1>
        <p className="text-slate">New events start as drafts, so nothing is public until you go live.</p>
      </div>
      <Suspense fallback={<p className="text-slate">Loading…</p>}>
        <NewEventForm />
      </Suspense>
    </div>
  );
}

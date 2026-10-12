import { createEventAction } from "@/lib/admin/actions";
import { Suspense } from "react";
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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New event</h1>
      <p className="text-sm text-zinc-600">New events start as drafts. Uploads and the printer token are set after creating it.</p>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <NewEventForm />
      </Suspense>
    </div>
  );
}

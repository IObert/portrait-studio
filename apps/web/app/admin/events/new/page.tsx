import { createEventAction } from "@/lib/admin/actions";
import { formOptions } from "@/lib/admin/options";
import { defaultConfig } from "@/lib/events/schema";
import { EventForm } from "../../_components/event-form";

export const metadata = { title: "New event · Portrait Studio" };

export default function NewEventPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New event</h1>
      <p className="text-sm text-zinc-600">New events start as drafts. Uploads and the printer token are set after creating it.</p>
      <EventForm action={createEventAction} config={defaultConfig("", "")} {...formOptions()} submitLabel="Create event" />
    </div>
  );
}

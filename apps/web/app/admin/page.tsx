import Link from "next/link";
import { Suspense } from "react";
import { getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { DeleteEvent } from "./_components/controls";
import { StateBadge } from "./_components/state-badge";

export const metadata = { title: "Events · Portrait Studio" };

async function EventList() {
  await requireAdmin();
  const events = await (await getEventRepo()).list();
  if (events.length === 0) return <p className="text-zinc-600">No events yet.</p>;
  return (
    <table className="w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
      <thead className="bg-zinc-100 text-left text-zinc-600">
        <tr>
          <th className="px-4 py-2 font-medium">Event</th>
          <th className="px-4 py-2 font-medium">Code</th>
          <th className="px-4 py-2 font-medium">State</th>
          <th className="px-4 py-2 font-medium">Language</th>
          <th className="px-4 py-2 font-medium">Printing</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.slug} className="border-t border-zinc-200">
            <td className="px-4 py-2">
              <Link href={`/admin/events/${e.slug}`} className="font-medium text-blue-700 hover:underline">
                {e.config.name}
              </Link>
            </td>
            <td className="px-4 py-2 font-mono">{e.slug}</td>
            <td className="px-4 py-2">
              <StateBadge state={e.state} />
            </td>
            <td className="px-4 py-2">{e.config.language}</td>
            <td className="px-4 py-2">{e.config.printingEnabled ? "on" : "off"}</td>
            <td className="px-4 py-2 text-right">
              <DeleteEvent slug={e.slug} name={e.config.name} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function DeletedNotice({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  if (!(await searchParams).deleted) return null;
  return (
    <p role="status" className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">
      Event deleted, with all its data.
    </p>
  );
}

export default function EventsPage(props: PageProps<"/admin">) {
  return (
    <div className="space-y-6">
      <Suspense>
        <DeletedNotice searchParams={props.searchParams} />
      </Suspense>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Link href="/admin/events/new" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
          New event
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Loading events…</p>}>
        <EventList />
      </Suspense>
    </div>
  );
}

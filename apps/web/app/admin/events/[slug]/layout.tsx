import { Suspense } from "react";
import { loadAdminEvent } from "@/lib/admin/event-load";
import { EventHeader, EventHeaderSkeleton } from "../../_components/event-header";

async function Header({ params }: { params: Promise<{ slug: string }> }) {
  return <EventHeader event={await loadAdminEvent((await params).slug)} />;
}

/**
 * Shared by Settings, Review and Stats. A layout stays mounted across its pages,
 * so switching tabs keeps the header and only swaps the content below it.
 */
export default function EventLayout({ children, params }: LayoutProps<"/admin/events/[slug]">) {
  return (
    <>
      <Suspense fallback={<EventHeaderSkeleton />}>
        <Header params={params} />
      </Suspense>
      {children}
    </>
  );
}

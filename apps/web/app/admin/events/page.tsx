import { redirect } from "next/navigation";

// The event list lives at /admin; keep old links working.
export default function EventsIndex() {
  redirect("/admin");
}

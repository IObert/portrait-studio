import Link from "next/link";

export default function EventNotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">404: event could not be found</h1>
      <p className="text-zinc-600">It may have been deleted.</p>
      <Link href="/admin" className="text-blue-700 hover:underline">
        Back to events
      </Link>
    </div>
  );
}

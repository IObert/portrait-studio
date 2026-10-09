import Link from "next/link";

export const metadata = { title: "Portrait Studio admin", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
          <Link href="/admin/events" className="font-semibold">
            Portrait Studio
          </Link>
          <Link href="/admin/events" className="text-sm text-zinc-600 hover:text-zinc-900">
            Events
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

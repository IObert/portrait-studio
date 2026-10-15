import Link from "next/link";
import { Mark } from "./_components/ui";

export const metadata = { title: "Portrait Studio admin", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-mist text-ink">
      <header className="bg-ink text-white">
        <nav className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3.5">
          <Link href="/admin" className="flex items-center gap-2.5 rounded-md font-display text-lg font-semibold tracking-tight focus-visible:outline-white">
            <Mark className="h-7" />
            Portrait Studio
          </Link>
          <Link href="/admin" className="text-sm text-white/70 hover:text-white focus-visible:outline-white">
            Events
          </Link>
          <a href="/logout" className="ml-auto inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white focus-visible:outline-white">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M8 4H4v12h4M12 6l4 4-4 4M16 10H8" />
            </svg>
            Log out
          </a>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
      <footer className="border-t border-line py-5 text-center text-xs text-slate">Made with <span role="img" aria-label="love">❤️</span> by Twilio</footer>
    </div>
  );
}

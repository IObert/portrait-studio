"use client";

import { useEffect, useState } from "react";

/**
 * Basic auth has no logout: the browser keeps the login until it sees a different
 * one. A request with throwaway credentials replaces it, so the next /admin visit
 * asks again. Works in Chrome, Firefox and Safari.
 */
export function SignOut() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    fetch("/admin", { headers: { authorization: `Basic ${btoa("signed-out:signed-out")}` }, cache: "no-store" })
      .catch(() => {})
      .finally(() => setDone(true));
  }, []);
  return (
    <div className="space-y-2" role="status">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{done ? "You're signed out" : "Signing out…"}</h1>
      <p className="text-white/70">Close the browser to be completely sure on a shared computer.</p>
    </div>
  );
}

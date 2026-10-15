// Placeholders shaped like each tab's content. Shown below the header (which stays put)
// only when a tab's data has not been prefetched yet.

const bar = "rounded-md bg-line/70 motion-safe:animate-pulse";

function Block({ className }: { className: string }) {
  return <div className={`${bar} ${className}`} />;
}

function Loading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-label={label}>
      <div aria-hidden>{children}</div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <Loading label="Loading settings">
      <div className="grid gap-10 lg:grid-cols-[11rem_1fr]">
        <div className="hidden space-y-3 lg:block">
          {[0, 1, 2, 3, 4].map((i) => (
            <Block key={i} className="h-4 w-28" />
          ))}
        </div>
        <div className="space-y-6">
          {[3, 4].map((rows, i) => (
            <div key={i} className="space-y-5 rounded-xl border border-line bg-white px-6 py-5">
              <Block className="h-5 w-40" />
              <div className="grid gap-5 sm:grid-cols-2">
                {Array.from({ length: rows }, (_, j) => (
                  <div key={j} className="space-y-2">
                    <Block className="h-4 w-24" />
                    <Block className="h-10 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

export function ReviewSkeleton() {
  return (
    <Loading label="Loading review">
      <div className="space-y-6">
        <div className="space-y-2">
          <Block className="h-7 w-32" />
          <Block className="h-4 w-80" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-5 rounded-xl border border-line bg-white p-5">
            <Block className="aspect-2/3 w-28" />
            <Block className="aspect-2/3 w-36" />
            <div className="flex-1 space-y-3">
              <Block className="h-5 w-48" />
              <Block className="h-14 w-full" />
              <Block className="h-9 w-56" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function StatsSkeleton() {
  return (
    <Loading label="Loading stats">
      <div className="space-y-6">
        <Block className="h-7 w-24" />
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-3 bg-white px-5 py-4">
              <Block className="h-4 w-24" />
              <Block className="h-8 w-12" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-3 rounded-xl border border-line bg-white px-5 py-4">
              <Block className="h-4 w-28" />
              {[0, 1, 2].map((j) => (
                <Block key={j} className="h-4 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

/** Top-left brand lockup on the booth screen. The logo is the official white SVG in public/ (the screen is dark). */
export function Lockup() {
  return (
    <div className="flex items-center gap-[1.8vh]">
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed local asset on a kiosk, no optimizer needed */}
      <img src="/twilio-logo-white.svg" alt="" className="h-[6vh] w-auto" />
      <p className="font-display text-[3.2vh] leading-none font-semibold tracking-tight">Portrait Studio by Twilio</p>
    </div>
  );
}

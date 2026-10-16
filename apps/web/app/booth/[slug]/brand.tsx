/** Top-left brand lockup on the booth screen. The logo is the official PNG in public/. */
export function Lockup() {
  return (
    <div className="flex items-center gap-[1.8vh]">
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed local asset on a kiosk, no optimizer needed */}
      <img src="/twilio-logo.png" alt="" className="h-[6vh] w-auto rounded-[1vh]" />
      <p className="font-display text-[3.2vh] leading-none font-semibold tracking-tight">Portrait Studio by Twilio</p>
    </div>
  );
}

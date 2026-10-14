# Fixed frames

Each file is a 1200×1800 PNG (4x6 portrait at 300 DPI) with a transparent window (alpha < 128) where the
portrait goes (SPEC §8.3). The file name is the frame id in `lib/events/schema.ts`.

| File | Status |
|---|---|
| `twilio-tab-bottom.png` | Overlay: red Twilio tab centred at the bottom; the portrait fills the print |
| `twilio-tab-bottom-left.png` | Overlay: red Twilio tab bottom left |
| `twilio-tab-top.png` | Overlay: red Twilio tab centred at the top |
| `twilio-border-left.png` | Red border, tilted window, logo top left |
| `twilio-border-right.png` | Red border, tilted window, logo top right |

The Twilio frames were supplied at 1200×1680. They were scaled to 1200 wide without changing the aspect ratio,
then the canvas was extended to 1800: by 120 px of transparency on the side away from the tab, or by 60 px of the
border red (#EF223A) at the top and bottom for the red-border frames.

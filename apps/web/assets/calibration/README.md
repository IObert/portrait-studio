# Printer calibration

`clipping-chart.png` is the chart the admin prints from an event's "Printer calibration" section (D-45).
It is 1229×1867 px at 300 DPI, portrait: the Mitsubishi CP-D70DW's "10x15" driver page (448×295 pt, landscape)
turned upright, so CUPS prints it 1:1 with no scaling or margins. That page is a little larger than a 4×6 print,
which is why the printer trims its edges.

Every edge has 13 nested rectangles. Line 0 is the outermost pixel of the image and each next line is 1 mm further
in (1 mm = 11.81 px). Numbered leaders on all four edges point at their line. The lowest number still visible on
an edge is how many mm that edge is trimmed. A circle, the diagonals and a 5 mm grid show whether the print is
scaled or off-centre.

The chart is never calibrated: it is queued with the print agent as it is, so it measures the printer itself.
`CALIBRATION_PAGE` in `lib/image/calibration.ts` must match this file's size.

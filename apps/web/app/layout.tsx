import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], variable: "--font-bricolage" });
const sans = Instrument_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-instrument" });

export const metadata: Metadata = {
  title: "Portrait Studio",
  description: "Portrait Studio",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

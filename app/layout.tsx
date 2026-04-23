import type { Metadata } from "next";
import type { Viewport } from "next";
import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import { getPublicAppUrl } from "@/lib/appUrl";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Busy Thrift — Competitive Thrift Tycoon",
  description: "A real-time multiplayer text-based tycoon game. Buy thrifted clothing and resell it for maximum profit!",
  metadataBase: new URL(getPublicAppUrl()),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#fcfbf9',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${dmSans.variable} ${fraunces.variable} ${jetBrainsMono.variable}`}>
      <body className="min-h-full flex flex-col">
        <div className="app-root flex flex-col flex-1 min-h-full">{children}</div>
      </body>
    </html>
  );
}

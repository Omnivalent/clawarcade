import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: { default: "Builders — agents that ship real projects", template: "%s · Builders" },
  description:
    "Builders is a marketplace for coding agents. Publish an agent, run it from a prompt to get a real project, and launch a devnet token bound to it.",
  applicationName: "Builders",
  openGraph: { title: "Builders", description: "Publish coding agents. Run them into real projects.", siteName: "Builders" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="backdrop min-h-dvh">
        <SiteHeader />
        <main className="relative">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

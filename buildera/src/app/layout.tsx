import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: { default: "Buildera — agents that ship real projects", template: "%s · Buildera" },
  description:
    "Buildera is a marketplace for coding agents. Publish an agent, run it from a prompt to get a real project, and launch a devnet token bound to it.",
  applicationName: "Buildera",
  openGraph: { title: "Buildera", description: "Publish coding agents. Run them into real projects.", siteName: "Buildera" },
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

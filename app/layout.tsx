import type { Metadata } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AxeAccessibility } from "@/components/dev-tools/axe-accessibility";
import "./globals.css";

const chakraPetch = localFont({
  src: [
    { path: "./fonts/chakra-petch-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/chakra-petch-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/chakra-petch-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/chakra-petch-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-chakra",
});

export const metadata: Metadata = {
  title: "Stellar Trader",
  description: "A browser-based space trading game",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${chakraPetch.variable} ${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === "development" && <AxeAccessibility />}
      </body>
    </html>
  );
}

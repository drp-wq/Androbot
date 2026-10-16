import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: "Solana Trading System",
  description: "Devnet-first paper trading operations dashboard",
  applicationName: "Solana Trading System"
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Solana Autonomous Trading System",
    short_name: "Solana Trading",
    description: "Paper trading operations dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1020",
    theme_color: "#0b1020",
    icons: []
  };
}

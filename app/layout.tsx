import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Morocco Eats - Discover Food in Morocco",
    template: "%s | Morocco Eats",
  },
  description:
    "Discover the best food spots in Morocco. Map-first food discovery for Marrakech, Casablanca, Rabat, Tangier, and Fes.",
  keywords: [
    "Morocco",
    "food",
    "restaurants",
    "tagine",
    "couscous",
    "Marrakech",
    "Casablanca",
    "Rabat",
    "Tangier",
    "Fes",
  ],
  authors: [{ name: "Morocco Eats Team" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Morocco Eats",
    title: "Morocco Eats - Discover Food in Morocco",
    description:
      "Discover the best food spots in Morocco. Map-first food discovery for Marrakech, Casablanca, Rabat, Tangier, and Fes.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}

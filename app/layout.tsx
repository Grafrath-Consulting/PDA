import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { VisibilityReload } from "@/components/VisibilityReload";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "PDA",
  description: "capture everything, organize later",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "PDA",
    description: "capture everything, organize later",
    images: [{ url: "/og-image-1280x640.png", width: 1280, height: 640 }],
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
        <VisibilityReload />
        {children}
      </body>
    </html>
  );
}

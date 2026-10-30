import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BRAND_NAME, BRAND_TITLE } from "../lib/brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: BRAND_TITLE,
  description: "내 갤럭시를 PC 브라우저에서. 게임·소설·웹툰을 위한 개인 원격 콘솔.",
  applicationName: BRAND_NAME,
  manifest: "/manifest.webmanifest?v=linro-7",
  icons: {
    icon: [{ url: "/favicon.ico?v=linro-7", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: "/favicon.svg?v=linro-7", type: "image/svg+xml" },
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" }],
    shortcut: "/favicon.ico?v=linro-7",
    apple: { url: "/brand/icon-180.png", sizes: "180x180" },
  },
  appleWebApp: { title: BRAND_NAME },
  openGraph: { title: BRAND_TITLE, description: "내 갤럭시를 PC 브라우저에서. 게임·소설·웹툰을 위한 개인 원격 콘솔.",
    images: [{ url: "/brand/social.png", width: 1200, height: 630, alt: "린로 · Linro — Link Road" }] },
};
export const viewport: Viewport = { themeColor: "#111C2A" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

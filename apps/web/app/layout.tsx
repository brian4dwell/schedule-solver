import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { LogRocketProvider } from "@/components/analytics/logrocket-provider";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { ToastProvider } from "@/components/ui/toast-provider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Schedule Solver",
  title: "Schedule Solver",
  description: "Surgery center scheduling workspace",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Schedule Solver",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    apple: [
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        url: "/apple-touch-icon.png",
      },
    ],
    icon: [
      {
        rel: "icon",
        sizes: "192x192",
        type: "image/png",
        url: "/icon-192x192.png",
      },
      {
        rel: "icon",
        sizes: "512x512",
        type: "image/png",
        url: "/icon-512x512.png",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider
          dynamic
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          afterSignOutUrl="/sign-in"
        >
          <LogRocketProvider>
            <ToastProvider>
              <ServiceWorkerRegistration />
              {children}
            </ToastProvider>
          </LogRocketProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

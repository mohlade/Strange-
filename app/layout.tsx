import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { CheckCircle2, Info, Loader2, TriangleAlert } from "lucide-react";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Strange Bets — Smart Betting Picks & Codes",
  description:
    "Pick your sport, choose your odds types, and get expert-consensus safe picks with a shareable betting code.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#0d0a16" />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <div className="grain" aria-hidden />
        <Toaster
          position="bottom-right"
          icons={{
            success: <CheckCircle2 className="h-4 w-4" style={{ color: "#c9a0ff" }} />,
            error: <TriangleAlert className="h-4 w-4" style={{ color: "#ff85c2" }} />,
            warning: <TriangleAlert className="h-4 w-4" style={{ color: "#fbbf24" }} />,
            info: <Info className="h-4 w-4" style={{ color: "#d4d4d8" }} />,
            loading: <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#c9a0ff" }} />,
          }}
          toastOptions={{
            style: {
              background: "#151021",
              border: "2px solid #f4f4f5",
              borderRadius: 0,
              color: "#f4f4f5",
              fontFamily: "var(--font-mono), monospace",
              fontSize: "13px",
              boxShadow: "4px 4px 0 rgba(162,89,255,0.9)",
            },
          }}
        />
      </body>
    </html>
  );
}

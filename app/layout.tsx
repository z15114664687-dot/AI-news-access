import type { Metadata } from "next";
import "../styles.css";

export const metadata: Metadata = {
  title: "AI Ecosystem Intelligence",
  description: "Private AI intelligence dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

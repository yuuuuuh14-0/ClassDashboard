import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "학급 진도 대시보드",
  description: "우리 반 수업 진도를 기록하고, 같은 학년의 흐름을 함께 살펴보세요.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}

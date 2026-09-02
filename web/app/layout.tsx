import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';

const siteUrl = 'https://kumi-report-slide-editor.minagawa30826.chatgpt.site';
const title = 'KUMI — Markdown Report / Slide Editor';
const description =
  'Markdownから技術報告書とプレゼンテーションを組み立てる文書エディター';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    url: siteUrl,
    siteName: 'KUMI',
    title,
    description,
    images: [
      {
        url: '/og.png',
        width: 1734,
        height: 907,
        alt: 'KUMI — Markdown Report / Slide Editor',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import {
  AppPreferencesProvider,
  preferenceBootstrapScript,
} from '@/components/app-preferences';
import 'katex/dist/katex.min.css';
import './globals.css';

const defaultSiteUrl =
  'https://kumi-report-slide-editor.minagawa30826.chatgpt.site';
const title = 'KUMI — Markdown Report / Slide Editor';
const description =
  'Markdownから技術報告書とプレゼンテーションを組み立てる文書エディター';

function resolveSiteUrl() {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!configuredSiteUrl) {
    return defaultSiteUrl;
  }

  try {
    const url = new URL(configuredSiteUrl);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString().replace(/\/$/, '')
      : defaultSiteUrl;
  } catch {
    return defaultSiteUrl;
  }
}

const siteUrl = resolveSiteUrl();
const metadataBase = new URL(`${siteUrl}/`);
const canonicalUrl = new URL('./', metadataBase).toString();
const siteAssetUrl = (path: string) => new URL(path, metadataBase).toString();

export const metadata: Metadata = {
  metadataBase,
  title,
  description,
  alternates: {
    canonical: canonicalUrl,
  },
  icons: {
    icon: [
      {
        url: siteAssetUrl('favicon.svg'),
        type: 'image/svg+xml',
      },
    ],
    shortcut: siteAssetUrl('favicon.svg'),
  },
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    url: canonicalUrl,
    siteName: 'KUMI',
    title,
    description,
    images: [
      {
        url: siteAssetUrl('og.png'),
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
    images: [siteAssetUrl('og.png')],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: preferenceBootstrapScript }}
        />
      </head>
      <body>
        <AppPreferencesProvider>{children}</AppPreferencesProvider>
      </body>
    </html>
  );
}

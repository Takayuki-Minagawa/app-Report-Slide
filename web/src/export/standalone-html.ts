import { bytesToBase64 } from './embedded-images';

/** A standalone file may run only the embedded script whose hash is in its CSP. */
export async function hashedInlineScript(
  source: string,
): Promise<{ script: string; policy: string }> {
  // HTML parsing normalizes line endings; hash exactly the bytes the browser sees.
  const script = source.replace(/\r\n?/g, '\n');
  const hash = bytesToBase64(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)),
    ),
  );
  return {
    script,
    policy:
      "default-src 'none'; img-src data: https: http:; font-src data:; style-src 'unsafe-inline'; script-src 'sha256-" +
      hash +
      "'; base-uri 'none'; form-action 'none'",
  };
}

// PKCE (RFC 7636) on WebCrypto (B-12 SD3, SD16): a random verifier and state, and the S256
// challenge. No library.

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `bytes` random bytes as base64url: 32 bytes give a 43-character verifier. */
export function randomString(
  random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size)),
  bytes = 32,
): string {
  return base64url(random(bytes));
}

/** The S256 challenge of `verifier`: base64url of its SHA-256. */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

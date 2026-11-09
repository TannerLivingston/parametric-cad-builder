// A link with the design in it, compressed, after the #, so it never reaches a server. Opening one
// loads the design. It works wherever the app does: on this machine now, and for anyone once it's hosted.
const KEY = "design=";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// What goes after the #. The text is minified first, since the layout of the JSON doesn't matter.
export async function designHash(text: string): Promise<string> {
  const compact = JSON.stringify(JSON.parse(text));
  return KEY + toBase64Url(await through(new TextEncoder().encode(compact), new CompressionStream("deflate-raw")));
}

// The design's text from a link's #, or null if it hasn't got one, or it's damaged.
export async function designFromHash(hash: string): Promise<string | null> {
  const at = hash.indexOf(KEY);
  if (at < 0) return null;
  try {
    const bytes = await through(fromBase64Url(hash.slice(at + KEY.length)), new DecompressionStream("deflate-raw"));
    const text = new TextDecoder().decode(bytes);
    JSON.parse(text);
    return text;
  } catch {
    return null;
  }
}

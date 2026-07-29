const POST_VISUAL_HUES = [212, 258, 326, 18, 154, 188];

export function getPostVisualHue(seed: string): number {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return POST_VISUAL_HUES[hash % POST_VISUAL_HUES.length];
}

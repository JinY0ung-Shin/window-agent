/**
 * Estimate token count for a string.
 * Korean syllables ≈ 1.5 tokens, other multibyte ≈ 1.2, ASCII ≈ 0.25.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7af) {
      tokens += 1.5; // Korean syllable
    } else if (code > 0x7f) {
      tokens += 1.2; // Other multibyte
    } else {
      tokens += 0.25; // ASCII
    }
  }
  return Math.ceil(tokens);
}

export function estimateMessageTokens(msg: {
  role: string;
  content: string;
}): number {
  return 4 + estimateTokens(msg.content); // 4 tokens overhead per message
}

/** Estimate additional tokens for image attachments. */
export const IMAGE_TOKENS_LOW = 85;
export const IMAGE_TOKENS_AUTO = 765; // Approximation for medium-sized images

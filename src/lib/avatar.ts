const emojiRegex = /\p{Extended_Pictographic}/u;

function isUrlLike(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("/")
  );
}

export function getAvatarLabel(name: string, avatar?: string): string {
  const normalizedName = name.trim();
  const fallback = normalizedName ? normalizedName.slice(0, 1).toUpperCase() : "A";

  if (!avatar) return fallback;

  const raw = avatar.trim();
  if (!raw || isUrlLike(raw)) return fallback;
  if (emojiRegex.test(raw)) return fallback;

  return raw.slice(0, 2).toUpperCase();
}

export function getNameInitial(name: string): string {
  const normalizedName = name.trim();
  return normalizedName ? normalizedName.slice(0, 1).toUpperCase() : "A";
}

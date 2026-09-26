// Deterministic SVG coin logos for simulated launches: /logo/<seed>.svg
// Same seed always draws the same coin, so a coin's face never changes between page loads.
function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const PALETTES = [
  ["#8B7CFF", "#43E8C0"], ["#43E8C0", "#4DA6FF"], ["#FFB55C", "#FF5C72"], ["#FF5C72", "#8B7CFF"],
  ["#4DA6FF", "#8B7CFF"], ["#2FD68A", "#43E8C0"], ["#FFD166", "#FFB55C"], ["#B78CFF", "#4DA6FF"],
];

export function logoSvg(seed) {
  const h = hash(seed);
  const [c1, c2] = PALETTES[h % PALETTES.length];
  const shape = (h >>> 4) % 6;
  const rot = (h >>> 8) % 360;
  const letter = (String(seed).match(/[a-z]/i)?.[0] ?? "b").toUpperCase();
  const dark = "#07080C";
  let inner = "";
  if (shape === 0) inner = `<circle cx="32" cy="32" r="13" fill="${dark}" opacity=".82"/>`;
  else if (shape === 1) inner = `<rect x="18" y="18" width="28" height="28" rx="8" fill="${dark}" opacity=".82" transform="rotate(${rot % 45} 32 32)"/>`;
  else if (shape === 2) inner = `<polygon points="32,15 49,44 15,44" fill="${dark}" opacity=".82" transform="rotate(${rot} 32 32)"/>`;
  else if (shape === 3) inner = `<path d="M32 14 L50 32 L32 50 L14 32 Z" fill="${dark}" opacity=".82"/>`;
  else if (shape === 4) inner = `<circle cx="24" cy="29" r="8" fill="${dark}" opacity=".82"/><circle cx="41" cy="29" r="8" fill="${dark}" opacity=".82"/>`;
  else inner = `<path d="M14 40c6-18 30-18 36 0z" fill="${dark}" opacity=".82"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${letter} coin">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="64" height="64" rx="16" fill="url(#g)"/>
${inner}
<text x="32" y="38" text-anchor="middle" font-family="Space Grotesk, Arial, sans-serif" font-weight="800" font-size="17" fill="${c1}">${letter}</text>
</svg>`;
}

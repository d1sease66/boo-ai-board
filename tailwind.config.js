/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // BOO runs dark: a phosphor board in a very dark room.
        ink: "#07080C",
        deep: "#0A0C12",
        panel: "#10131B",
        panel2: "#161A24",
        raise: "#1C212D",
        line: "#1F2531",
        line2: "#2C3444",
        fg: "#E9ECF4",
        muted: "#8B93A7",
        dim: "#5C6478",
        brand: "#8B7CFF",      // spectral violet
        brand2: "#6F5CF0",
        glow: "#43E8C0",       // phosphor mint
        bull: "#2FD68A",
        bear: "#FF5C72",
        warn: "#FFB55C",
        key: "#4DA6FF",
      },
      borderRadius: { card: "18px", pill: "999px" },
      // extra opacity steps so `@apply bg-brand/12` and friends resolve inside components
      opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, String(i / 100)])),
      fontFamily: {
        sans: ["Space Grotesk", "Inter", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,.03) inset, 0 20px 60px -40px rgba(0,0,0,.9)",
        glow: "0 0 0 1px rgba(139,124,255,.25), 0 18px 50px -22px rgba(139,124,255,.45)",
        mint: "0 0 0 1px rgba(67,232,192,.25), 0 18px 50px -24px rgba(67,232,192,.35)",
      },
      keyframes: {
        flash: { "0%": { backgroundColor: "rgba(139,124,255,0.14)" }, "100%": { backgroundColor: "transparent" } },
        rise: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "none" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".3" } },
        marquee: { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(-50%)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
      },
      animation: {
        flash: "flash 1.8s ease-out",
        rise: "rise .35s cubic-bezier(.2,.8,.2,1)",
        pulseDot: "pulseDot 1.5s ease-in-out infinite",
        marquee: "marquee 38s linear infinite",
        shimmer: "shimmer 1.6s infinite",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

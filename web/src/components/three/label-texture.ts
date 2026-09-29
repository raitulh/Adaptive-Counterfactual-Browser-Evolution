import * as THREE from "three";

/**
 * Text labels for the WebGL scene, drawn once into canvas textures (white, tinted per use by the
 * sprite material). No DOM overlays, no per-frame layout work. Uses the page's mono font.
 */
const cache = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();

function monoFamily(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--font-jetbrains-mono").trim();
    return v ? `${v}, ui-monospace, monospace` : "ui-monospace, monospace";
  } catch {
    return "ui-monospace, monospace";
  }
}

export function labelTexture(
  text: string,
  { uppercase = true, tracking = 0.18 } = {},
): { texture: THREE.CanvasTexture; aspect: number } {
  const key = `${text}|${uppercase}|${tracking}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const label = uppercase ? text.toUpperCase() : text;
  const px = 44;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `500 ${px}px ${monoFamily()}`;
  const draw = () => {
    if (!ctx) return;
    ctx.font = font;
    const spacing = px * tracking;
    const width = Math.ceil([...label].reduce((w, ch) => w + ctx.measureText(ch).width + spacing, 0) + px);
    const height = Math.ceil(px * 1.6);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    let x = px / 2;
    for (const ch of label) {
      ctx.fillText(ch, x, height / 2);
      x += ctx.measureText(ch).width + spacing;
    }
  };
  draw();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const entry = { texture, aspect: canvas.width / Math.max(1, canvas.height) };
  cache.set(key, entry);

  // Redraw once the web font is available (the first draw may have used a fallback font).
  if (typeof document !== "undefined" && document.fonts?.load) {
    document.fonts
      .load(font)
      .then(() => {
        draw();
        entry.aspect = canvas.width / Math.max(1, canvas.height);
        texture.needsUpdate = true;
      })
      .catch(() => {});
  }
  return entry;
}

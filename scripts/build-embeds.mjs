// Builds the reel pages as standalone HTML files for the website: script and styles inlined,
// so each file opens by double-click or in an <iframe>, without a server.
// usage: node scripts/build-embeds.mjs <outDir>
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(process.argv[2] ?? join(root, "dist-embeds"));
mkdirSync(out, { recursive: true });

// page → files it becomes; the embed page is baked once per reel style.
const pages = [
  { html: "preview/embed/reels.html", outputs: ["licht", "vakuum", "praezision"].map((style) => ({ name: `clonq-reels-${style}.html`, style })) },
  { html: "preview/reel-lab/licht.html", outputs: [{ name: "labor-licht.html" }] },
  { html: "preview/reel-lab/vakuum.html", outputs: [{ name: "labor-vakuum.html" }] },
  { html: "preview/reel-lab/praezision.html", outputs: [{ name: "labor-praezision.html" }] },
];

for (const page of pages) {
  const tmp = join(root, "node_modules", ".embed-build");
  rmSync(tmp, { recursive: true, force: true });
  await build({
    configFile: false,
    root,
    base: "./",
    logLevel: "warn",
    // The drawings carry no text: the web fonts (all scripts, several MB) are left out.
    // Tailwind resolves the @imports itself, so the font lines are cut from app.css before it runs.
    plugins: [
      { name: "no-fonts", enforce: "pre", transform: (code, id) => (id.endsWith("/src/styles/app.css") ? code.replace(/^@import "@fontsource\/[^"]+";\n/gm, "") : null) },
      react(),
      tailwindcss(),
    ],
    build: {
      outDir: tmp,
      emptyOutDir: true,
      modulePreload: false,
      cssCodeSplit: false,
      assetsInlineLimit: 100_000_000,
      rollupOptions: { input: join(root, page.html), output: { format: "iife" } },
    },
  });
  const built = join(tmp, page.html);
  let html = readFileSync(built, "utf8");
  const assets = join(tmp, "assets");
  // Replace the script and stylesheet tags with their contents.
  html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
    const code = readFileSync(join(assets, src.split("/").pop()), "utf8").replaceAll("</script", "<\\/script");
    return `<script>${code}</script>`;
  });
  html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${readFileSync(join(assets, href.split("/").pop()), "utf8")}</style>`);
  // Scripts must run after the #root element exists. Replacer functions only: minified code
  // contains "$'" and "$&", which a replacement string would expand into copies of the page.
  const code = (html.match(/<script>([\s\S]*?)<\/script>/) ?? ["", ""])[1];
  html = html.replace(/<script>[\s\S]*?<\/script>/, () => "").replace("</body>", () => `<script>${code}</script></body>`);
  for (const output of page.outputs) {
    const file = output.style ? html.replace("<html lang=\"en\">", `<html lang="en" data-style="${output.style}">`) : html;
    writeFileSync(join(out, output.name), file);
    console.log(`${output.name}  ${(file.length / 1024).toFixed(0)} KB`);
  }
  rmSync(tmp, { recursive: true, force: true });
}
console.log(readdirSync(out).join("\n"));

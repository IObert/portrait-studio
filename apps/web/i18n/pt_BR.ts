import type { Catalog } from "./types";

// TODO(review): pt_BR copy needs a native-speaker review (docs/decisions.md).
export const pt_BR = {
  styles: {
    cartoon: { name: "Desenho 3D", aliases: ["pixar", "3d", "cartoon", "desenho"] },
    "pop-art": { name: "Pop Art", aliases: ["popart", "warhol"] },
    watercolor: { name: "Aquarela", aliases: ["pintura"] },
    anime: { name: "Anime", aliases: ["mangá", "manga"] },
    sketch: { name: "Esboço", aliases: ["lápis", "lapis", "desenho a lápis"] },
    "pixel-art": { name: "Pixel Art", aliases: ["pixel", "8bit", "16bit", "retrô", "retro"] },
  },
  backgrounds: {
    gradient: { name: "Degradê", aliases: ["degrade", "gradiente"] },
    "solid-white": { name: "Branco", aliases: ["fundo branco"] },
    "solid-black": { name: "Preto", aliases: ["fundo preto"] },
    original: { name: "Original", aliases: ["manter", "mesmo"] },
  },
} satisfies Catalog;

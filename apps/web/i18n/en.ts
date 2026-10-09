import type { Catalog } from "./types";

export const en = {
  styles: {
    cartoon: { name: "Cartoon", aliases: ["pixar", "3d"] },
    "pop-art": { name: "Pop Art", aliases: ["popart", "warhol"] },
    watercolor: { name: "Watercolor", aliases: ["watercolour", "painting"] },
    anime: { name: "Anime", aliases: ["manga"] },
    sketch: { name: "Sketch", aliases: ["pencil", "drawing"] },
    "pixel-art": { name: "Pixel Art", aliases: ["pixel", "8bit", "16bit", "retro"] },
  },
  backgrounds: {
    gradient: { name: "Gradient", aliases: [] },
    "solid-white": { name: "White", aliases: ["solid white"] },
    "solid-black": { name: "Black", aliases: ["solid black"] },
    original: { name: "Original", aliases: ["keep", "same"] },
  },
} satisfies Catalog;

import type { Locale } from "../lib/events/schema";
import { en } from "./en";
import { pt_BR } from "./pt_BR";
import type { Catalog } from "./types";

export const catalogs: Record<Locale, Catalog> = { en, pt_BR };
export type { Catalog };

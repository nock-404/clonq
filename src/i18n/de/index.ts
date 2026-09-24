import type { Catalog } from "..";
import { common } from "./common";
import { detail } from "./detail";
import { locations } from "./locations";
import { messages } from "./messages";
import { shell } from "./shell";
import { wizard } from "./wizard";

export const de: Catalog = { common, messages, shell, detail, wizard, locations };

/**
 * The public datasets liedar is evaluated on. Each one downloads itself into
 * its own folder under eval/data and lists its documents with ground truth.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { downloadZip } from "./downloads.ts";

export type Sample = {
  /** Unique within the dataset, and stable across runs. */
  id: string;
  path: string;
  fraud: boolean;
  /** Attributes to break results down by, such as the forgery tool. */
  tags: Record<string, string>;
};

export type Dataset = {
  description: string;
  download(directory: string): Promise<void>;
  samples(directory: string): Promise<Sample[]>;
};

export const DATA_DIRECTORY = join(import.meta.dirname, "data");

const FIND_IT_AGAIN_SPLITS = ["train", "val", "test"];

export const DATASETS: Record<string, Dataset> = {
  "find-it-again": {
    description:
      "Find it again! (ICDAR 2023): 988 scanned receipts from SROIE, 163 forged by hand in Paint, GIMP, and other editors.",
    download: (directory) =>
      downloadZip("https://l3i-share.univ-lr.fr/2023Finditagain/findit2.zip", directory),
    async samples(directory) {
      const samples: Sample[] = [];
      for (const split of FIND_IT_AGAIN_SPLITS) {
        const [, ...rows] = (await readFile(join(directory, "findit2", `${split}.txt`), "utf8")).trim().split("\n");
        for (const row of rows) {
          // Columns: image, digital annotation, handwritten annotation, forged, forgery annotations.
          const [image = "", , , forged] = row.split(",");
          const fraud = forged === "1";
          samples.push({
            id: image,
            path: join(directory, "findit2", split, image),
            fraud,
            tags: { split, software: fraud ? (row.match(/'Software used': '([^']+)'/)?.[1] ?? "unknown") : "none" },
          });
        }
      }
      // X51006619709.png is listed as forged in train and genuine in val, but only the train copy exists.
      return samples.filter((sample) => existsSync(sample.path));
    },
  },
};

export function datasetNamed(name: string | undefined): Dataset {
  const dataset = name ? DATASETS[name] : undefined;
  if (!dataset) {
    throw new Error(`Name a dataset: ${Object.keys(DATASETS).join(", ")}`);
  }
  return dataset;
}

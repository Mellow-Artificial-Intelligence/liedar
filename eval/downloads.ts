/**
 * Downloads a dataset's zip archive and extracts it.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

/** Downloads a zip archive and extracts it into `directory`, unless that's already been done. */
export async function downloadZip(url: string, directory: string) {
  const extracted = join(directory, ".extracted");
  if (existsSync(extracted)) {
    return;
  }
  const archive = join(directory, "archive.zip");
  if (!existsSync(archive)) {
    console.error(`Downloading ${url}...`);
    await downloadFile(url, archive);
  }
  console.error(`Extracting ${archive}...`);
  await promisify(execFile)("unzip", ["-q", "-o", archive, "-d", directory, "-x", "__MACOSX/*"]);
  await writeFile(extracted, "");
}

async function downloadFile(url: string, destination: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  // Written under a temporary name first, so an interrupted download is retried rather than kept.
  const partial = `${destination}.partial`;
  await writeFile(partial, new Uint8Array(await response.arrayBuffer()));
  await rename(partial, destination);
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const relativePath = file => path.relative(root, file).split(path.sep).join("/");
const cyrillicTranscriptPattern = /^docs\/(gemini-dialogue-cleaned|conversations\/(?:chess[^/]*|ChatGPT-tal)|plans\/(PLAN|MVP_mating_pattern_catalog_plan))\.md$/;

const collect = dir => {
  const files = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      if (entry.isFile()) files.push(full);
    }
  };
  walk(dir);
  return files;
};

test("repository files contain no Cyrillic text", () => {
  const scanned = collect(root).filter(file => (
    !file.includes("node_modules")
    && !file.includes(`${path.sep}.git${path.sep}`)
    && !file.includes(`${path.sep}.local${path.sep}`)
    && !file.includes(`${path.sep}docs${path.sep}reviews${path.sep}`)
    && !file.endsWith("package-lock.json")
    && !cyrillicTranscriptPattern.test(relativePath(file))
  ));
  const offenders = scanned.filter(file => /[\u0400-\u04FF]/u.test(fs.readFileSync(file, "utf8"))).map(relativePath);
  expect(offenders).toEqual([]);
});

test("domain layer does not depend on adapter/application directories", () => {
  const domainFiles = collect(path.join(root, "src", "domain")).filter(file => file.endsWith(".ts"));
  const offenders = domainFiles.flatMap(file => {
    const text = fs.readFileSync(file, "utf8");
    return ["../../adapters", "../adapters", "../../application", "../application"].filter(pattern => text.includes(pattern)).map(pattern => `${relativePath(file)} -> ${pattern}`);
  });
  expect(offenders).toEqual([]);
});

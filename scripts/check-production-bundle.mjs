import fs from "node:fs";
import path from "node:path";

const BEHAVIORAL_PARITY_FILES = [
  "pack-suggestions.json",
  "field-suggestions.json",
  "search-score.json",
  "trip-brief.json",
];

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  });
}

function caseNames(golden) {
  return [golden.cases, golden.tokenCases]
    .filter(Array.isArray)
    .flat()
    .map((testCase) => testCase.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

const parityDirectory = path.resolve("packages/contracts/parity");
const bundleDirectory = path.resolve("apps/web/dist");

if (!fs.existsSync(bundleDirectory)) {
  throw new Error(`production web bundle is missing: ${bundleDirectory}`);
}

const markers = BEHAVIORAL_PARITY_FILES.flatMap((file) => {
  const golden = JSON.parse(
    fs.readFileSync(path.join(parityDirectory, file), "utf8"),
  );
  const names = caseNames(golden);
  if (names.length === 0) {
    throw new Error(`behavioral parity fixture has no case names: ${file}`);
  }
  return names.map((name) => ({ file, name }));
});

const leaks = [];
for (const bundleFile of collectFiles(bundleDirectory)) {
  const contents = fs.readFileSync(bundleFile);
  for (const marker of markers) {
    if (contents.includes(Buffer.from(marker.name, "utf8"))) {
      leaks.push({ ...marker, bundleFile: path.relative(".", bundleFile) });
    }
  }
}

if (leaks.length > 0) {
  const details = leaks
    .map(
      ({ file, name, bundleFile }) =>
        `  ${file}: ${JSON.stringify(name)} found in ${bundleFile}`,
    )
    .join("\n");
  throw new Error(
    `behavioral parity data entered the production bundle:\n${details}`,
  );
}

console.log(
  `Production bundle excludes ${markers.length} behavioral parity case names.`,
);

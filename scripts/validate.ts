// Checks a config file and prints what's wrong. Usage: npm run validate -- <file.json>
import { readFileSync } from "node:fs";
import { validateConfig } from "../src/index.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run validate -- <config.json>");
  process.exit(2);
}

const result = validateConfig(JSON.parse(readFileSync(file, "utf8")));
for (const issue of result.ok ? [] : result.errors) {
  console.log(`error    ${issue.code}  ${issue.path}\n         ${issue.message}`);
}
for (const issue of result.warnings) {
  console.log(`warning  ${issue.code}  ${issue.path}\n         ${issue.message}`);
}
if (result.ok) {
  const parts = result.plan.printedParts.map((p) => p.size.map((s) => Math.round(s * 10) / 10).join(" x "));
  console.log(`\nValid: ${result.plan.cutouts.length} cutouts, ${parts.length} printed part(s): ${parts.join(", ")} mm`);
} else {
  console.log(`\nInvalid: ${result.errors.length} error(s)`);
  process.exit(1);
}

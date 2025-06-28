// Version update script (scripts/update-version.js)
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const version = args[0];

if (!version) {
  console.error("Please provide a version number");
  process.exit(1);
}

// Update manifest.json
const manifestPath = path.join(__dirname, "../manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// Update package.json
const packagePath = path.join(__dirname, "../package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
packageJson.version = version;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));

console.log(`✅ Updated version to ${version}`);

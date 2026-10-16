#!/usr/bin/env node
// Offline secret scanner for tracked files. Fails closed: any match exits non-zero.
// It reads `git ls-files`, so only content that would be committed is inspected.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const NAME_RULES = [
  { label: "tracked .env file", match: (path) => /(^|\/)\.env$/.test(path) },
  { label: "tracked .env.* file (other than .example)", match: (path) => /(^|\/)\.env\.[^/]+$/.test(path) && !path.endsWith(".env.example") },
  { label: "tracked key/keystore/wallet file", match: (path) => /\.(key|pem|p12|pfx|seed|keystore)$/i.test(path) },
  { label: "tracked wallet file", match: (path) => /(^|\/)(id|keypair|wallet)\.json$/i.test(path) }
];

const CONTENT_RULES = [
  { label: "PEM private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { label: "AWS access key id", pattern: /AKIA[0-9A-Z]{16}/ },
  { label: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { label: "Slack token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { label: "Solana secret key byte array", pattern: /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/ },
  {
    label: "assigned secret value",
    pattern: /(secret|private[-_]?key|seed|mnemonic|passphrase|password|api[-_]?key|access[-_]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i
  }
];

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return output.split("\0").filter((entry) => entry.length > 0);
}

function isProbablyBinary(content) {
  return content.includes("\u0000");
}

const findings = [];

for (const path of trackedFiles()) {
  for (const rule of NAME_RULES) {
    if (rule.match(path)) findings.push({ path, label: rule.label });
  }

  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (isProbablyBinary(content)) continue;

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of CONTENT_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ path, label: rule.label, line: index + 1 });
      }
    }
  }
}

if (findings.length > 0) {
  process.stderr.write("Secret scan failed. Review these tracked locations:\n");
  for (const finding of findings) {
    const location = finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`;
    process.stderr.write(`  - ${location} (${finding.label})\n`);
  }
  process.exit(1);
}

process.stdout.write("Secret scan passed: no secrets found in tracked files.\n");

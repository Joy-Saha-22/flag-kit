import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Allowlist for justified exceptions. Keep this empty unless a rule truly needs a narrow exception.
const allowlist = {};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');
const targetFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(fullPath);
      continue;
    }

    const normalized = path.relative(clientRoot, fullPath);
    if (!/\.(js|jsx|css|html)$/i.test(entry.name)) continue;
    if (normalized.startsWith('tests/')) continue;
    if (normalized === 'index.html' || normalized.startsWith('src/')) {
      targetFiles.push(fullPath);
    }
  }
}

walk(path.join(clientRoot, 'src'));
targetFiles.push(path.join(clientRoot, 'index.html'));

const ruleChecks = [
  { rule: 'lucide or sparkle', pattern: /lucide|sparkle/i },
  { rule: 'skeleton loader', pattern: /skeleton/i },
  { rule: 'backdrop blur', pattern: /backdrop-blur|blur-/i },
  { rule: 'gradient', pattern: /gradient/i },
  { rule: 'pure white', pattern: /#fff\b|#ffffff\b|rgb\(255\s*,\s*255\s*,\s*255\)|bg-white\b|text-white\b|border-white\b|ring-white\b|fill-white\b|stroke-white\b/i },
  { rule: 'shadow classes', pattern: /\bshadow(?:-(?:sm|md|lg|xl|2xl))?\b|drop-shadow/i },
  { rule: 'radius classes', pattern: /rounded-(?:md|lg|xl|2xl|3xl|full)|rounded\b/i },
  { rule: 'motion', pattern: /animate-|transition|duration-|ease-|@keyframes|transform|scale-|translate-|rotate-|hover:scale|group-hover:translate/i },
  { rule: 'Inter, Geist or Space Grotesk', pattern: /Inter|Geist|Space Grotesk|@fontsource\/inter|\bgeist\b/i },
  { rule: 'em dash', pattern: /\u2014/ },
  { rule: 'emoji', pattern: /[\p{Extended_Pictographic}]/gu },
  { rule: 'checkmark', pattern: /[\u2713\u2714\u2705\u2611]/g },
  { rule: 'left stripe', pattern: /border-l-(?:[2-8])|border-left\s*:\s*(?:[2-9]|[1-9]\d+)px/i },
  { rule: 'terms or privacy words', pattern: /Terms of Service|Privacy Policy|Pricing|testimonial/i },
  { rule: 'pricing route or filename', pattern: /pricing|terms|privacy/i },
];

describe('design rules', () => {
  it('enforces the dashboard design rules', () => {
    const violations = [];

    for (const file of targetFiles) {
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        for (const rule of ruleChecks) {
          if (rule.pattern.test(line)) {
            const relative = path.relative(clientRoot, file).replace(/\\/g, '/');
            const key = `${relative}:${index + 1}:${rule.rule}`;
            if (!allowlist[key]) {
              violations.push({ file: relative, line: index + 1, rule: rule.rule, text: line.trim() });
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

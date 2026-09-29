#!/usr/bin/env node
// Generates kiro/singularity-review.json's toolsSettings.shell.deniedCommands
// from guard.js's own DENY_RULES, so the two never hand-drift again.
//
// Kiro's deny list is a flat array of regex strings — it has no predicate
// mechanism, so only the RegExp entries in DENY_RULES (not the function
// entries) have a Kiro equivalent. Three of guard.js's twelve rules cannot
// be expressed here at all:
//   - bare `terraform apply` without a saved plan file (needs tokenizing
//     the command and walking past flags — a predicate, not a pattern)
//   - a STALE saved plan file (needs an mtime comparison against the
//     filesystem — not expressible as a regex over the command string)
//   - force-push specifically to main/master (needs correlating a flag
//     token with a branch-name token that can appear in either order —
//     two separate matches ANDed together, which a single regex can't do
//     cleanly without becoming unreadable and fragile)
// Kiro users get a narrower net for those three; that gap is documented in
// README.md's Risks section, not hidden here.
//
// Run with --check in CI: exits 1 and prints a diff if kiro/singularity-review.json
// has drifted from what this generator would produce. Run with no flag to
// regenerate the file in place.

const fs = require('fs');
const path = require('path');
const { DENY_RULES } = require('../hooks/singularity-review/guard.js');

const KIRO_JSON_PATH = path.join(__dirname, '..', 'kiro', 'singularity-review.json');

function generateDeniedCommands() {
  return DENY_RULES
    .filter(([rule]) => rule instanceof RegExp)
    .map(([rule]) => {
      // guard.js's regexes open with \b (word boundary) and are checked
      // against a quote-stripped, otherwise-unanchored substring of the
      // full command. Kiro's own existing entries wrap the same idea as
      // `.*<pattern>.*` with no leading \b — match that convention so the
      // generated list looks hand-written and stays diffable.
      const src = rule.source.replace(/^\\b/, '');
      return `.*${src}.*`;
    });
}

function main() {
  const check = process.argv.includes('--check');
  const generated = generateDeniedCommands();

  const raw = fs.readFileSync(KIRO_JSON_PATH, 'utf8');
  const config = JSON.parse(raw);
  const current = (config.toolsSettings && config.toolsSettings.shell && config.toolsSettings.shell.deniedCommands) || [];

  const matches = JSON.stringify(current) === JSON.stringify(generated);

  if (check) {
    if (matches) {
      console.log('kiro/singularity-review.json deniedCommands matches guard.js DENY_RULES.');
      process.exit(0);
    }
    console.error('kiro/singularity-review.json deniedCommands has drifted from guard.js DENY_RULES.');
    console.error('Expected:');
    console.error(JSON.stringify(generated, null, 2));
    console.error('Found:');
    console.error(JSON.stringify(current, null, 2));
    console.error('\nRun `node scripts/sync-kiro-deny-list.js` (no --check) to regenerate.');
    process.exit(1);
  }

  if (matches) {
    console.log('Already in sync, nothing to do.');
    return;
  }

  config.toolsSettings.shell.deniedCommands = generated;
  fs.writeFileSync(KIRO_JSON_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log(`Wrote ${generated.length} denied-command patterns to kiro/singularity-review.json.`);
}

main();

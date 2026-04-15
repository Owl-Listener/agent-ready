// shared/test.js
//
// A tiny, dependency-free smoke test for the shared module.
// Run it with:
//
//     node shared/test.js
//
// It reads example.json (a minimal fake Figma file), runs the
// checks, and prints:
//
//   1. The raw CheckResult array (what the agent would receive
//      programmatically)
//   2. The @agent-ready-report comment block (what the agent
//      would paste at the top of generated code)
//
// If the fixture and the checks agree, we know the pipeline works
// end to end: canonical node in, evidence trail out. That is the
// whole point of Stage A.

const fs = require('fs');
const path = require('path');

const { runAllChecks } = require('./checks');
const { generateReport, overallScore } = require('./report');

// Read the fixture from disk. __dirname keeps this working no
// matter where you run the script from.
const fixturePath = path.join(__dirname, 'example.json');
const raw = fs.readFileSync(fixturePath, 'utf8');
const root = JSON.parse(raw);

// 1. Run every check we've ported so far.
const results = runAllChecks(root);

// 2. Show the structured result first, so it's obvious what
//    data the report is built from.
console.log('=== CheckResults ===');
console.log(JSON.stringify(results, null, 2));
console.log('');

console.log('=== Weighted file score ===');
console.log(overallScore(results) + '/100');
console.log('');

// 3. Build the evidence block, passing in some sample inferences
//    and a confidence call so you can see what a "real" report
//    would look like in practice.
const report = generateReport(results, {
  fileName: 'Example file',
  inferences: [
    'Inferred purpose of COMPONENT_SET "Button" from its name (no description found).',
    'Inferred purpose of COMPONENT "Avatar" from its name (description was whitespace only).',
  ],
  confidence: 'medium',
});

console.log('=== @agent-ready-report block ===');
console.log(report);

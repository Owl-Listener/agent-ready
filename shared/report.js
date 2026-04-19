// shared/report.js
//
// Turns an array of CheckResults (from checks.js) into two things:
//
//   1. overallScore(results)   — a single weighted number, 0-100,
//                                matching the plugin's scoring math
//                                so the plugin and the agent always
//                                agree on what "this file is 62"
//                                means.
//
//   2. generateReport(results, options)
//                              — a structured, machine-parseable
//                                evidence block the agent can paste
//                                at the top of generated code. This
//                                is the "@agent-ready-report" block,
//                                i.e. the evidence trail the essay
//                                talks about.
//
// Why this file is separate from checks.js:
//
//   checks.js answers "what is true about this file".
//   report.js answers "how do we tell a human about it".
//
// Keeping those apart means we can evolve the report format
// without touching the checks, and we can add a new check
// without touching the report.
//

// Bump this when the skill's contract with the agent changes —
// new checks added, scoring math changed, report fields reshaped.
// The agent writes this into the report so a reviewer can tell
// at a glance which version of the skill produced the output.
const SKILL_VERSION = '0.3.0';

/**
 * Compute a single weighted score across all check results.
 *
 * Each check carries its own `weight` (critical=5, high=3,
 * moderate=2, output=2). The file-level score is the weighted
 * average of the individual check scores.
 *
 * This mirrors the scoring math in the plugin's code.js, so the
 * plugin and the agent produce the same number for the same file.
 * That matters: if a designer sees "62" in the plugin and the
 * agent says "62" in its report comment, they are talking about
 * the same thing.
 */
function overallScore(results) {
  if (!results || results.length === 0) {
    return 100;
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const result of results) {
    weightedSum += result.score * result.weight;
    totalWeight += result.weight;
  }

  if (totalWeight === 0) {
    return 100;
  }

  return Math.round(weightedSum / totalWeight);
}

/**
 * Collect only the issues from checks marked "critical" impact.
 * These are the ones that most hurt the agent's ability to produce
 * correct code, and the ones we want surfaced at the top of the
 * report rather than buried in a long list.
 */
function collectCriticalIssues(results) {
  const critical = [];
  for (const result of results) {
    if (result.impact === 'critical') {
      for (const issue of result.issues) {
        critical.push({
          check: result.id,
          nodeName: issue.nodeName,
          message: issue.message,
        });
      }
    }
  }
  return critical;
}

/**
 * Build the @agent-ready-report evidence block.
 *
 * The agent pastes this as a comment at the top of any code it
 * generates from a Figma file. It's structured so a human can
 * skim it, and structured enough that a tool could parse it
 * later without us having to redesign anything.
 *
 * Parameters:
 *   results — array of CheckResults from runAllChecks()
 *   options — optional extras the agent fills in:
 *     fileName:    name of the Figma file (e.g. "Checkout v3")
 *     inferences:  array of strings like
 *                  "Inferred primary CTA = first button variant with fill=blue-600"
 *     confidence:  "high" | "medium" | "low" — the agent's own
 *                  gut call on the result, after applying any
 *                  silent compensations
 */
function generateReport(results, options = {}) {
  const score = overallScore(results);
  const criticalIssues = collectCriticalIssues(results);
  const inferences = options.inferences || [];
  const confidence = options.confidence || 'medium';
  const fileName = options.fileName || '(unnamed file)';

  // We build this as an array of lines and join at the end, so the
  // formatting is obvious and easy to tweak.
  const lines = [];
  lines.push('/*');
  lines.push(' * @agent-ready-report');
  lines.push(` * skill-version: ${SKILL_VERSION}`);
  lines.push(` * file: ${fileName}`);
  lines.push(` * file-score: ${score}/100`);
  lines.push(` * checks-run: ${results.length}`);
  lines.push(' *');

  if (criticalIssues.length === 0) {
    lines.push(' * critical-gaps: none');
  } else {
    lines.push(` * critical-gaps: ${criticalIssues.length}`);
    for (const issue of criticalIssues) {
      lines.push(` *   - [${issue.check}] ${issue.nodeName}: ${issue.message}`);
    }
  }
  lines.push(' *');

  if (inferences.length === 0) {
    lines.push(' * inferences: none');
  } else {
    lines.push(` * inferences: ${inferences.length}`);
    for (const inf of inferences) {
      lines.push(` *   - ${inf}`);
    }
  }
  lines.push(' *');

  lines.push(` * confidence: ${confidence}`);
  lines.push(' *');
  lines.push(' * This block was generated by the Agent Ready skill.');
  lines.push(' * It documents what the agent saw in the Figma file,');
  lines.push(' * what it had to guess, and how confident it is. A human');
  lines.push(' * reviewer should read this before trusting the code below.');
  lines.push(' */');

  return lines.join('\n');
}

module.exports = {
  SKILL_VERSION,
  overallScore,
  collectCriticalIssues,
  generateReport,
};

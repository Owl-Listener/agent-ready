// shared/checks.js
//
// Pure check functions for Agent Ready.
//
// Each function takes a "canonical node" — a plain JavaScript object
// describing a Figma node — and returns a CheckResult. No Figma API
// calls, no plugin sandbox dependencies, no side effects. That way
// this file runs identically inside the Figma plugin (once we add a
// bundler) and inside Node when an agent calls it today.
//
// ============================================================
// Canonical Node Shape (the input these checks expect)
// ============================================================
// {
//   id: string,                 // stable identifier
//   type: string,               // "DOCUMENT", "PAGE", "COMPONENT",
//                               // "COMPONENT_SET", "FRAME", "INSTANCE",
//                               // "TEXT", "RECTANGLE", "ELLIPSE", etc.
//   name: string,               // layer name
//   description?: string,       // on components and component sets
//   children?: Node[],          // child nodes in the tree
//
//   // --- fields for token-binding check ---
//   fills?: Fill[],             // array of fill objects, each with { type, visible? }
//   strokes?: Stroke[],         // array of stroke objects
//   effects?: Effect[],         // array of effect objects
//   fillStyleId?: string,       // non-empty if fill is bound to a style or variable
//   strokeStyleId?: string,     // non-empty if stroke is bound
//   effectStyleId?: string,     // non-empty if effect is bound
//   textStyleId?: string,       // for TEXT nodes, non-empty if text is bound
//
//   // --- field for code-connect check ---
//   hasCodeConnect?: boolean,   // true if the component has a Code Connect
//                               // mapping, a dev resource, or is marked
//                               // READY_FOR_DEV. The MCP adapter normalises
//                               // all three into this single flag.
//   parentType?: string,        // type of the parent node — used to tell
//                               // standalone components from variants
//                               // inside a component set.
// }
//
// ============================================================
// CheckResult shape (what every check returns)
// ============================================================
// {
//   id: string,                 // stable id, e.g. "descriptions"
//   label: string,              // human label, e.g. "Component descriptions"
//   impact: "critical" | "high" | "moderate" | "output",
//   weight: number,             // scoring weight (crit=5, high=3, mod=2, out=2)
//   score: number,              // 0-100
//   passed: number,             // how many items passed
//   total: number,              // how many items were examined
//   issues: Issue[],
// }
//
// Issue: { nodeId, nodeName, message, severity }

// Figma's auto-generated layer names. Matches "Frame", "Frame 247",
// "Rectangle 4", etc. Case-insensitive.
const DEFAULT_NAME_PATTERN =
  /^(Frame|Group|Rectangle|Ellipse|Line|Vector|Polygon|Star|Boolean|Slice|Image|Text)\s*\d*$/i;

// Keywords that signal a component description is talking about
// PURPOSE or USAGE, not just appearance. This is a rough heuristic —
// a real description could pass without any of these words — but
// it catches the most common failure mode: descriptions that only
// describe what something looks like rather than what it is for.
const PURPOSE_KEYWORDS = [
  'use when',
  'use for',
  'use this',
  'purpose',
  'for ',
  'instead',
  'variant',
  'prefer',
  'pair with',
  'avoid',
  'do not',
  "don't",
  'when to',
  'when the',
  'meant to',
  'intended',
];

/**
 * Walk a tree and collect every node that matches a predicate.
 * This is the small helper every check reuses so we don't rewrite
 * the recursion each time.
 */
function collectNodes(root, predicate) {
  const results = [];

  function walk(node) {
    if (predicate(node)) {
      results.push(node);
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return results;
}

// --------------------------------------------------------------
// Check 1: Component descriptions (critical)
// --------------------------------------------------------------
// Every COMPONENT and COMPONENT_SET should have a non-empty description
// explaining what the component is for. Without this, an agent reading
// the file has to infer purpose from the component name alone, which
// is too thin a signal and produces generic, wrong code.
//
// This is the single most important check in the set — empty
// descriptions are the biggest reason agent output goes sideways.

function checkDescriptions(root) {
  const components = collectNodes(
    root,
    (node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
  );

  const issues = [];
  let passed = 0;

  for (const component of components) {
    const description = (component.description || '').trim();

    if (description.length === 0) {
      issues.push({
        nodeId: component.id,
        nodeName: component.name,
        message:
          'Component has no description. An agent reading this file will have to infer its purpose from the name alone.',
        severity: 'critical',
      });
    } else {
      passed++;
    }
  }

  const total = components.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'descriptions',
    label: 'Component descriptions',
    impact: 'critical',
    weight: 5,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 2: Description quality (high)
// --------------------------------------------------------------
// A non-empty description can still be useless. "A rounded button
// with an icon" tells the agent what the thing looks like but not
// what it is for or when to use it. Figma's 2025 design-systems-and-AI
// ebook is explicit about this: "Explain the 'why.' Describe each
// component's purpose and when to use it, not just how it looks."
//
// This check runs ONLY on components that already passed the
// descriptions check (i.e. have a non-empty description). It's a
// quality bar on top of the presence bar.
//
// The heuristic is deliberately crude: we look for at least one
// purpose/usage keyword, and we look for a minimum length of ~30
// characters. A description can fail this check and still be good
// (we will never catch everything with keywords), and it can pass
// and still be bad (nothing stops a designer from writing
// "purpose purpose purpose"), but in practice it flags the clear
// failure cases without false-positiving on good descriptions.

function checkDescriptionQuality(root) {
  const components = collectNodes(
    root,
    (node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
  );

  // Only score components that have a description at all.
  // Empty descriptions are the job of the descriptions check.
  const withDescription = components.filter(
    (c) => (c.description || '').trim().length > 0
  );

  const issues = [];
  let passed = 0;

  for (const component of withDescription) {
    const description = component.description.trim().toLowerCase();
    const hasKeyword = PURPOSE_KEYWORDS.some((kw) => description.includes(kw));
    const longEnough = description.length >= 30;

    if (!hasKeyword || !longEnough) {
      issues.push({
        nodeId: component.id,
        nodeName: component.name,
        message:
          'Description is present but does not explain purpose or usage. Say what this component is for, when to use it, and what to use instead.',
        severity: 'high',
      });
    } else {
      passed++;
    }
  }

  const total = withDescription.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'description-quality',
    label: 'Description quality (purpose + usage)',
    impact: 'high',
    weight: 3,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 3: Layer naming (critical)
// --------------------------------------------------------------
// Figma gives new layers names like "Frame 247", "Rectangle 4",
// "Group 12". These tell an agent nothing about what the layer is
// for. Every unnamed layer is a piece of structure the agent has to
// infer purely from visual context, which is exactly where
// hallucinations come from.
//
// We skip DOCUMENT, PAGE, and COMPONENT/COMPONENT_SET nodes because
// those have their own checks and their own naming conventions.

function checkLayerNaming(root) {
  const nodes = collectNodes(root, (node) => {
    return (
      node.type !== 'DOCUMENT' &&
      node.type !== 'PAGE' &&
      node.type !== 'COMPONENT' &&
      node.type !== 'COMPONENT_SET'
    );
  });

  const issues = [];
  let passed = 0;

  for (const node of nodes) {
    const name = (node.name || '').trim();
    if (DEFAULT_NAME_PATTERN.test(name)) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        message:
          'Layer has a default Figma name. Rename to describe its purpose (e.g. "hero-heading", "nav-divider") so an agent can use it as a semantic hint.',
        severity: 'critical',
      });
    } else {
      passed++;
    }
  }

  const total = nodes.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'layer-naming',
    label: 'Layer naming',
    impact: 'critical',
    weight: 5,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 4: Token binding (high)
// --------------------------------------------------------------
// The plugin's original check asked whether fills, strokes, and
// effects used any style at all. Figma's 2025 ebook sharpens this:
// tokens should not just exist in the file, they should be BOUND
// to the component instances. A variable that is defined but never
// attached to a fill is invisible to an agent reading the node.
// This check walks every node that carries visual styling and
// verifies there is a style or variable reference on it.
//
// We skip INSTANCE nodes because they inherit styling from their
// source component, so an unbound fill on an instance is not the
// instance's fault.

function checkTokenBinding(root) {
  const nodes = collectNodes(root, (node) => {
    // A node is "stylable" if it has any visible styling fields.
    // The canonical shape carries these as optional arrays.
    const hasFills =
      Array.isArray(node.fills) &&
      node.fills.some((f) => f && f.visible !== false);
    const hasStrokes =
      Array.isArray(node.strokes) &&
      node.strokes.some((s) => s && s.visible !== false);
    const hasEffects =
      Array.isArray(node.effects) &&
      node.effects.some((e) => e && e.visible !== false);
    const isText = node.type === 'TEXT';
    return (
      node.type !== 'INSTANCE' && (hasFills || hasStrokes || hasEffects || isText)
    );
  });

  const issues = [];
  let passed = 0;

  for (const node of nodes) {
    const problems = [];

    // Fills should be bound if they exist and are visible.
    if (
      Array.isArray(node.fills) &&
      node.fills.some((f) => f && f.visible !== false)
    ) {
      if (!node.fillStyleId || node.fillStyleId === '') {
        problems.push('fill');
      }
    }

    // Same rule for strokes.
    if (
      Array.isArray(node.strokes) &&
      node.strokes.some((s) => s && s.visible !== false)
    ) {
      if (!node.strokeStyleId || node.strokeStyleId === '') {
        problems.push('stroke');
      }
    }

    // Effects (shadows, blurs) should be bound too.
    if (
      Array.isArray(node.effects) &&
      node.effects.some((e) => e && e.visible !== false)
    ) {
      if (!node.effectStyleId || node.effectStyleId === '') {
        problems.push('effect');
      }
    }

    // Text nodes should have a text style bound.
    if (node.type === 'TEXT') {
      if (!node.textStyleId || node.textStyleId === '') {
        problems.push('text style');
      }
    }

    if (problems.length === 0) {
      passed++;
    } else {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        message:
          'Unbound ' +
          problems.join(', ') +
          '. A variable that is defined but not attached to the node is invisible to an agent — the raw value is all it can see.',
        severity: 'high',
      });
    }
  }

  const total = nodes.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'token-binding',
    label: 'Token binding',
    impact: 'high',
    weight: 3,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 5: Code Connect mapping (critical)
// --------------------------------------------------------------
// Code Connect maps a Figma component to a real component in a
// codebase. Without it, the agent sees Figma's prop names
// ("Type=Primary", "State=Hover") and has to guess how they map
// to code props. With it, the agent knows exactly what to import.
//
// The canonical shape carries this as a single boolean,
// `hasCodeConnect`. The MCP adapter is responsible for setting
// this to true if ANY of the following hold:
//   - the component has a Code Connect mapping (any namespace)
//   - the component has at least one dev resource
//   - the component is marked READY_FOR_DEV in Dev Mode
//
// From the agent's point of view, any of those three is a real
// bridge between design and code.

function checkCodeConnect(root) {
  // Check component sets and standalone components. A COMPONENT
  // inside a COMPONENT_SET is a variant — we check the set, not
  // each variant.
  const targets = collectNodes(root, (node) => {
    if (node.type === 'COMPONENT_SET') return true;
    if (node.type === 'COMPONENT') {
      // A variant inside a component set is not a standalone target.
      return node.parentType !== 'COMPONENT_SET';
    }
    return false;
  });

  const issues = [];
  let passed = 0;

  for (const component of targets) {
    if (component.hasCodeConnect === true) {
      passed++;
    } else {
      issues.push({
        nodeId: component.id,
        nodeName: component.name,
        message:
          'No Code Connect mapping, dev resource, or READY_FOR_DEV status. The agent will have to guess how Figma props translate to code props.',
        severity: 'critical',
      });
    }
  }

  const total = targets.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'code-connect',
    label: 'Code Connect mapping',
    impact: 'critical',
    weight: 4,
    score,
    passed,
    total,
    issues,
  };
}

/**
 * Run every check currently implemented and return an array of
 * results. As we port more checks from code.js, we add them here.
 */
function runAllChecks(root) {
  return [
    checkDescriptions(root),
    checkDescriptionQuality(root),
    checkLayerNaming(root),
    checkTokenBinding(root),
    checkCodeConnect(root),
  ];
}

module.exports = {
  collectNodes,
  checkDescriptions,
  checkDescriptionQuality,
  checkLayerNaming,
  checkTokenBinding,
  checkCodeConnect,
  runAllChecks,
  // constants exported so a test could reuse the same keywords
  PURPOSE_KEYWORDS,
  DEFAULT_NAME_PATTERN,
};

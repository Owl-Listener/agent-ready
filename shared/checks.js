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
//
//   // --- field for component-properties check ---
//   componentPropertyDefinitions?: object,
//                               // structured props (boolean/text/instance-swap)
//                               // on COMPONENT_SET and standalone COMPONENT
//                               // nodes. An empty object or missing field
//                               // means the component is relying on variant
//                               // strings alone, which an agent has to parse.
//
//   // --- field for auto-layout check ---
//   layoutMode?: string,        // "NONE" | "VERTICAL" | "HORIZONTAL" on
//                               // frames. Missing or "NONE" means absolute
//                               // positioning, which encodes no intent.
//
//   // --- field for real-content check ---
//   characters?: string,        // the actual text on a TEXT node. Used to
//                               // spot lorem ipsum, "Label", "$0.00", etc.
//
//   // --- fields for accessibility check ---
//   width?: number,             // frame/section dimensions — used to tell
//   height?: number,            // big layout frames from small decorative
//                               //  ones so we don't flag every tiny box.
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

// Placeholder text patterns — lorem ipsum, generic labels, fake
// contact info. A TEXT node matching any of these is actively
// misleading: an agent will name functions and variables as if
// the UI really does what the placeholder says. The list comes
// from the plugin's original check and is intentionally strict
// (full-string match for generic labels so "Label Heading" doesn't
// false-positive on the word "Label").
const PLACEHOLDER_PATTERNS = [
  /lorem\s+ipsum/i,
  /dolor\s+sit\s+amet/i,
  /consectetur\s+adipiscing/i,
  /^placeholder$/i,
  /^text$/i,
  /^label$/i,
  /^title$/i,
  /^heading$/i,
  /^subtitle$/i,
  /^description$/i,
  /^body\s*text$/i,
  /^caption$/i,
  /^your\s+text\s+here$/i,
  /^type\s+something$/i,
  /^enter\s+text$/i,
  /^add\s+text$/i,
  /^click\s+here$/i,
  /^\$0\.00$/,
  /^0\.00$/,
  /^XX+$/,
  /^---+$/,
  /^\.\.\.$/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  /^(MM|DD|YYYY|mm|dd|yyyy)[\/\-](MM|DD|YYYY|mm|dd|yyyy)[\/\-](MM|DD|YYYY|mm|dd|yyyy)$/i,
  /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(2000|0000)$/,
  /^(email|name|user|first\.?name|last\.?name)@(example|company|test|domain)\.(com|org|net)$/i,
  /^(555|000|123)[\s\-]?\d{3}[\s\-]?\d{4}$/,
  /^(123|000)\s*(main|any|fake)\s*(st|street|ave|road)/i,
  /^(first|last)\s*name$/i,
  /^(email|phone)\s*address$/i,
  /^(user|display)\s*name$/i,
  /^(company|org)\s*name$/i,
];

// Component name fragments that signal the component is interactive
// and therefore owes the user a full set of states (hover, disabled,
// loading, error). A decorative card does not.
const INTERACTIVE_KEYWORDS = [
  'button',
  'input',
  'link',
  'tab',
  'toggle',
  'checkbox',
  'radio',
  'select',
];

// Variant values that count as "states" when we look at whether an
// interactive component is complete. Case-insensitive match against
// the right-hand side of a variant pair like "State=Hover".
const STATE_VALUES = [
  'hover',
  'pressed',
  'disabled',
  'focused',
  'loading',
  'error',
  'active',
];

// Node types that count as raw shapes for the component-coverage
// check. A rectangle sitting next to a set of proper instances is
// almost always an undocumented UI element the agent has to guess at.
const RAW_SHAPE_TYPES = [
  'RECTANGLE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'LINE',
  'VECTOR',
];

// Naming-consistency heuristics for size variants. We flag a set
// that mixes the short form (sm/md/lg) with the long form
// (Small/Medium/Large) because one of them is the one the agent
// will pick when generating code — and it might not be the one
// the rest of the codebase uses.
const SIZE_SHORT_PATTERN = /^(xs|sm|md|lg|xl|xxl)$/i;
const SIZE_LONG_PATTERN = /^(small|medium|large|extra)/i;

// Accessibility keywords we look for in frame names and descriptions.
// If a section-sized frame has any of these, we take it as evidence
// that the designer has thought about semantics, roles, landmarks,
// or focus — and skip it in the flag list.
const A11Y_KEYWORDS =
  /role|landmark|aria|focus|tab.?order|reading.?order|accessible|screen.?reader|semantic/i;

// Thresholds for the whole-file checks, kept at module scope so
// they're easy to find and tune without hunting through function
// bodies.
const MAX_HIERARCHY_DEPTH = 8;
const SECTION_MIN_WIDTH = 200;
const SECTION_MIN_HEIGHT = 100;

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

// --------------------------------------------------------------
// Check 6: Component properties (critical)
// --------------------------------------------------------------
// Figma components can carry structured properties — booleans, text
// fields, instance-swap slots — alongside their variant matrix.
// A component that exposes `componentPropertyDefinitions` hands the
// agent a typed API it can map to code. A component that has a grid
// of variants but no properties hands the agent a set of strings
// like "Type=Primary, State=Hover" and forces it to parse them out
// of the variant name. The variant string is a fallback, not a
// substitute — this check flags the gap so the agent knows to
// parse and note the inference.
//
// A COMPONENT inside a COMPONENT_SET is a variant, not a standalone
// target. We check the set, not each variant, for the same reason
// the Code Connect check does.

function checkComponentProperties(root) {
  const targets = collectNodes(root, (node) => {
    if (node.type === 'COMPONENT_SET') return true;
    if (node.type === 'COMPONENT') {
      return node.parentType !== 'COMPONENT_SET';
    }
    return false;
  });

  const issues = [];
  let passed = 0;

  for (const component of targets) {
    const defs = component.componentPropertyDefinitions;
    const hasProps = defs && typeof defs === 'object' && Object.keys(defs).length > 0;

    if (hasProps) {
      passed++;
    } else {
      issues.push({
        nodeId: component.id,
        nodeName: component.name,
        message:
          'No boolean, text, or instance-swap properties. The agent will have to parse the variant name string to extract props.',
        severity: 'critical',
      });
    }
  }

  const total = targets.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'component-properties',
    label: 'Component properties',
    impact: 'critical',
    weight: 4,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 7: Auto-layout coverage (high)
// --------------------------------------------------------------
// A frame with auto-layout encodes intent: this is a row, this is
// a stack, this wraps. A frame without auto-layout is just absolute
// coordinates, and the agent has to infer layout by looking at child
// positions — an easy place for guesses to go wrong. We only flag
// frames that actually have multiple children, because a one-child
// frame has nothing to lay out.
//
// We include COMPONENT and INSTANCE as well as FRAME because all
// three can carry auto-layout.

function checkAutoLayout(root) {
  const frames = collectNodes(root, (node) => {
    const isFrameLike =
      node.type === 'FRAME' ||
      node.type === 'COMPONENT' ||
      node.type === 'INSTANCE';
    return (
      isFrameLike && Array.isArray(node.children) && node.children.length > 1
    );
  });

  const issues = [];
  let passed = 0;

  for (const frame of frames) {
    const mode = frame.layoutMode;
    const hasAutoLayout = mode === 'VERTICAL' || mode === 'HORIZONTAL';

    if (hasAutoLayout) {
      passed++;
    } else {
      issues.push({
        nodeId: frame.id,
        nodeName: frame.name,
        message:
          'Frame has multiple children but no auto-layout. The agent has to infer layout intent from absolute positions.',
        severity: 'high',
      });
    }
  }

  const total = frames.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'auto-layout',
    label: 'Auto-layout coverage',
    impact: 'high',
    weight: 3,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 8: Real content (high)
// --------------------------------------------------------------
// Lorem ipsum, "Label", "$0.00", fake emails — placeholder content
// misleads the agent. It names functions and variables based on
// what the UI appears to say, and every "Label Heading" becomes
// `labelHeading` in code that nobody wants. We flag text nodes
// whose content matches any placeholder pattern in the module-level
// PLACEHOLDER_PATTERNS list.

function checkRealContent(root) {
  const textNodes = collectNodes(root, (node) => node.type === 'TEXT');

  const issues = [];
  let passed = 0;

  for (const node of textNodes) {
    const text = (node.characters || '').trim();
    if (text === '') {
      // Empty text is a separate problem, not this check's job.
      passed++;
      continue;
    }

    const matches = PLACEHOLDER_PATTERNS.some((p) => p.test(text));
    if (matches) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        message:
          'Placeholder text detected ("' +
          (text.length > 40 ? text.slice(0, 40) + '…' : text) +
          '"). The agent will name functions and variables based on this, which reads wrong in real code.',
        severity: 'high',
      });
    } else {
      passed++;
    }
  }

  const total = textNodes.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'real-content',
    label: 'Real content',
    impact: 'high',
    weight: 3,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 9: State completeness (high)
// --------------------------------------------------------------
// Interactive components owe the user a full set of states — at
// minimum default, hover, and disabled; often focused, loading,
// and error too. A button with only a "Default" variant forces
// the agent to fabricate hover and disabled styling from thin air,
// or to skip them entirely. Both are bad. This check looks at
// component sets whose names look interactive (button, input, tab,
// etc.) and counts how many of the STATE_VALUES appear as variant
// values on their children.
//
// The heuristic is deliberately loose: we treat any component set
// with at least three of the expected states as "complete enough",
// which matches the plugin's threshold and avoids flagging every
// interactive component on the planet for missing "loading".

function checkStateCompleteness(root) {
  const componentSets = collectNodes(
    root,
    (node) => node.type === 'COMPONENT_SET'
  );

  const interactive = componentSets.filter((set) => {
    const name = (set.name || '').toLowerCase();
    return INTERACTIVE_KEYWORDS.some((kw) => name.includes(kw));
  });

  const issues = [];
  let passed = 0;

  for (const set of interactive) {
    const values = new Set();
    const children = Array.isArray(set.children) ? set.children : [];
    for (const child of children) {
      const pairs = (child.name || '').split(',').map((p) => p.trim().toLowerCase());
      for (const pair of pairs) {
        const [, value] = pair.split('=').map((s) => (s || '').trim());
        if (value) values.add(value);
      }
    }

    const present = STATE_VALUES.filter((s) => values.has(s));
    if (present.length >= 3) {
      passed++;
    } else {
      const missing = STATE_VALUES.filter((s) => !values.has(s)).slice(0, 3);
      issues.push({
        nodeId: set.id,
        nodeName: set.name,
        message:
          'Interactive component is missing states: ' +
          missing.join(', ') +
          '. The agent will have to invent these or omit them.',
        severity: 'high',
      });
    }
  }

  const total = interactive.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'state-completeness',
    label: 'State completeness',
    impact: 'high',
    weight: 3,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 10: Component coverage (moderate)
// --------------------------------------------------------------
// A raw rectangle next to a row of proper instances is almost
// always an undocumented UI element the agent has to guess at.
// We only flag raw shapes that live at the frame/page level — not
// the ones INSIDE a component or instance, because those are
// building blocks and not the problem. The score is the ratio of
// instances to (instances + loose raw shapes).
//
// We need the path from a node back to the root to tell "loose" from
// "inside a component", and the canonical shape doesn't carry parent
// pointers. The cheapest fix is to precompute that containment from
// the tree itself.

function checkComponentCoverage(root) {
  const componentishIds = new Set();
  (function walk(node, insideComponent) {
    if (insideComponent) {
      componentishIds.add(node.id);
    }
    if (Array.isArray(node.children)) {
      const nowInside =
        insideComponent ||
        node.type === 'COMPONENT' ||
        node.type === 'COMPONENT_SET' ||
        node.type === 'INSTANCE';
      for (const child of node.children) {
        walk(child, nowInside);
      }
    }
  })(root, false);

  const instances = collectNodes(root, (node) => node.type === 'INSTANCE');
  const looseRawShapes = collectNodes(root, (node) => {
    return (
      RAW_SHAPE_TYPES.includes(node.type) && !componentishIds.has(node.id)
    );
  });

  const total = instances.length + looseRawShapes.length;
  const score = total === 0 ? 100 : Math.round((instances.length / total) * 100);

  const issues = looseRawShapes.map((node) => ({
    nodeId: node.id,
    nodeName: node.name,
    message:
      'Loose ' +
      node.type.toLowerCase() +
      ' sitting outside any component. If this is reusable UI, it should be a component; if not, the agent cannot tell.',
    severity: 'moderate',
  }));

  return {
    id: 'component-coverage',
    label: 'Component coverage',
    impact: 'moderate',
    weight: 2,
    score,
    passed: instances.length,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 11: Naming consistency (moderate)
// --------------------------------------------------------------
// Variants that mix "sm" with "Small" or "Primary" with "primary"
// force the agent to pick a convention — and it might not pick the
// one the rest of the codebase uses. We gather every variant
// property value across every component set and flag any property
// that mixes the short and long size forms, or the same value in
// two different cases.

function checkNamingConsistency(root) {
  const componentSets = collectNodes(
    root,
    (node) => node.type === 'COMPONENT_SET'
  );

  // { propertyName: Set<value> }
  const propValues = {};

  for (const set of componentSets) {
    const children = Array.isArray(set.children) ? set.children : [];
    for (const child of children) {
      const pairs = (child.name || '').split(',').map((p) => p.trim());
      for (const pair of pairs) {
        const [key, value] = pair.split('=').map((s) => (s || '').trim());
        if (key && value) {
          if (!propValues[key]) propValues[key] = new Set();
          propValues[key].add(value);
        }
      }
    }
  }

  const issues = [];
  let passed = 0;

  for (const [prop, valueSet] of Object.entries(propValues)) {
    const values = Array.from(valueSet);
    const hasShort = values.some((v) => SIZE_SHORT_PATTERN.test(v));
    const hasLong = values.some((v) => SIZE_LONG_PATTERN.test(v));
    const lowered = values.map((v) => v.toLowerCase());
    const caseCollision = new Set(lowered).size < values.length;

    if (hasShort && hasLong) {
      issues.push({
        nodeId: prop,
        nodeName: prop,
        message:
          'Property "' +
          prop +
          '" mixes short and long size forms (' +
          values.join(', ') +
          '). Pick one convention so the agent does not have to.',
        severity: 'moderate',
      });
    } else if (caseCollision) {
      issues.push({
        nodeId: prop,
        nodeName: prop,
        message:
          'Property "' +
          prop +
          '" has values that only differ in case (' +
          values.join(', ') +
          '). Standardise so the agent does not have to normalise.',
        severity: 'moderate',
      });
    } else {
      passed++;
    }
  }

  const total = Object.keys(propValues).length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'naming-consistency',
    label: 'Naming consistency',
    impact: 'moderate',
    weight: 2,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 12: Hierarchy depth (moderate)
// --------------------------------------------------------------
// Figma lets designers nest frames inside frames inside frames.
// Deep nesting usually reflects Figma's layout mechanics, not the
// DOM the agent should produce. If the agent reads the Figma tree
// literally, the output ends up with ten layers of meaningless
// divs. We flag any node deeper than MAX_HIERARCHY_DEPTH from the
// scan root so the agent knows to flatten its mental model.

function checkHierarchy(root) {
  const tooDeep = [];
  let nodeCount = 0;

  (function walk(node, depth) {
    nodeCount++;
    if (depth > MAX_HIERARCHY_DEPTH) {
      tooDeep.push({ node, depth });
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  })(root, 0);

  const issues = tooDeep.map(({ node, depth }) => ({
    nodeId: node.id,
    nodeName: node.name,
    message:
      'Node is nested ' +
      depth +
      ' levels deep. Most of this depth is Figma scaffolding, not DOM intent — flatten before generating markup.',
    severity: 'moderate',
  }));

  const total = nodeCount;
  const passed = total - tooDeep.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'hierarchy',
    label: 'Hierarchy depth',
    impact: 'moderate',
    weight: 2,
    score,
    passed,
    total,
    issues,
  };
}

// --------------------------------------------------------------
// Check 13: Page organisation (moderate)
// --------------------------------------------------------------
// A single Figma page with hundreds of top-level frames is a wall
// of noise. The agent has to load all of it into context to find
// the one frame the user cares about, which burns tokens and
// invites wrong answers. A file split across a few pages
// (Foundations / Components / Patterns / Screens) gives the agent
// a chance to scope down.
//
// This check only runs when we have a DOCUMENT node at the root,
// because only then can we see the page layout. When the agent is
// scanning a single frame or component set, we return a total of 0
// and a score of 100 — there's nothing to evaluate.

function checkPageOrganisation(root) {
  if (!root || root.type !== 'DOCUMENT' || !Array.isArray(root.children)) {
    return {
      id: 'page-organisation',
      label: 'Page organisation',
      impact: 'moderate',
      weight: 2,
      score: 100,
      passed: 0,
      total: 0,
      issues: [],
    };
  }

  const pages = root.children.filter((n) => n.type === 'PAGE');
  const pageCount = pages.length;
  const maxTopLevelFrames = pages.reduce((max, page) => {
    const count = Array.isArray(page.children) ? page.children.length : 0;
    return Math.max(max, count);
  }, 0);

  let score = 100;
  if (pageCount === 1 && maxTopLevelFrames > 50) score = 30;
  else if (pageCount === 1 && maxTopLevelFrames > 30) score = 50;
  else if (pageCount === 1 && maxTopLevelFrames > 15) score = 70;
  else if (pageCount === 2) score = 85;
  // pageCount >= 3 keeps the score at 100.

  const issues = [];
  if (pageCount === 1 && maxTopLevelFrames > 30) {
    const only = pages[0];
    issues.push({
      nodeId: only.id,
      nodeName: only.name,
      message:
        'Single page with ' +
        maxTopLevelFrames +
        ' top-level frames. Split into Foundations / Components / Patterns / Screens so the agent can scope to the relevant section.',
      severity: 'moderate',
    });
  }

  return {
    id: 'page-organisation',
    label: 'Page organisation',
    impact: 'moderate',
    weight: 2,
    score,
    passed: pageCount,
    total: Math.max(pageCount, 1),
    issues,
  };
}

// --------------------------------------------------------------
// Check 14: Accessibility annotations (output quality)
// --------------------------------------------------------------
// This is the one check that is explicitly about what the AGENT
// produces, not what it reads. If a large section frame has a
// description or name that mentions roles, landmarks, reading
// order, or focus, the agent can apply it; otherwise it falls
// back to defaults that may or may not be right for the design.
//
// We only look at "section-sized" frames (width > SECTION_MIN_WIDTH,
// height > SECTION_MIN_HEIGHT) because annotating every tiny
// decorative box would be noise. If width/height are missing from
// the canonical shape we include the frame anyway — better to flag
// a few extra than to silently skip a whole file.

function checkAccessibility(root) {
  const sections = collectNodes(root, (node) => {
    const isFrameLike =
      node.type === 'FRAME' ||
      node.type === 'COMPONENT' ||
      node.type === 'INSTANCE';
    if (!isFrameLike) return false;
    const bigEnough =
      (typeof node.width !== 'number' || node.width > SECTION_MIN_WIDTH) &&
      (typeof node.height !== 'number' || node.height > SECTION_MIN_HEIGHT);
    return bigEnough;
  });

  const issues = [];
  let passed = 0;

  for (const section of sections) {
    const description = (section.description || '').trim();
    const name = (section.name || '').trim();
    const annotated =
      A11Y_KEYWORDS.test(description) || A11Y_KEYWORDS.test(name);

    if (annotated) {
      passed++;
    } else {
      issues.push({
        nodeId: section.id,
        nodeName: section.name,
        message:
          'Section has no landmark, role, reading-order, or focus annotation. The agent will fall back to default semantics.',
        severity: 'moderate',
      });
    }
  }

  const total = sections.length;
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);

  return {
    id: 'accessibility',
    label: 'Accessibility annotations',
    impact: 'output',
    weight: 2,
    score,
    passed,
    total,
    issues,
  };
}

/**
 * Run every check currently implemented and return an array of
 * results. v0.3.0: all 13 conceptual checks from SKILL.md are now
 * executable. Description coverage and description quality ship as
 * two separate functions so quality is scored independently of
 * presence, giving 14 CheckResults total.
 */
function runAllChecks(root) {
  return [
    checkDescriptions(root),
    checkDescriptionQuality(root),
    checkLayerNaming(root),
    checkComponentProperties(root),
    checkCodeConnect(root),
    checkAutoLayout(root),
    checkTokenBinding(root),
    checkRealContent(root),
    checkStateCompleteness(root),
    checkComponentCoverage(root),
    checkNamingConsistency(root),
    checkHierarchy(root),
    checkPageOrganisation(root),
    checkAccessibility(root),
  ];
}

module.exports = {
  collectNodes,
  checkDescriptions,
  checkDescriptionQuality,
  checkLayerNaming,
  checkTokenBinding,
  checkCodeConnect,
  checkComponentProperties,
  checkAutoLayout,
  checkRealContent,
  checkStateCompleteness,
  checkComponentCoverage,
  checkNamingConsistency,
  checkHierarchy,
  checkPageOrganisation,
  checkAccessibility,
  runAllChecks,
  // constants exported so a test could reuse the same keywords
  PURPOSE_KEYWORDS,
  DEFAULT_NAME_PATTERN,
  PLACEHOLDER_PATTERNS,
  INTERACTIVE_KEYWORDS,
  STATE_VALUES,
  RAW_SHAPE_TYPES,
  SIZE_SHORT_PATTERN,
  SIZE_LONG_PATTERN,
  A11Y_KEYWORDS,
  MAX_HIERARCHY_DEPTH,
  SECTION_MIN_WIDTH,
  SECTION_MIN_HEIGHT,
};

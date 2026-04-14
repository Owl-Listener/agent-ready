// ============================================================
// AGENT READY — Figma Plugin Sandbox (code.js)
// by MC Dean
//
// This file runs INSIDE Figma. It can see every layer in your
// file, but it has no visual interface. It talks to the UI
// panel (ui.html) by sending messages back and forth.
// ============================================================

// --- STEP 1: Show the UI panel ---
// This tells Figma "open a panel with our ui.html file."
// The width/height sets the panel size.
figma.showUI(__html__, { width: 400, height: 720 });

// --- STEP 2: Listen for messages from the UI ---
// When the designer clicks "Scan Frame" in the UI, the UI
// sends us a message. We listen for it here.
figma.ui.onmessage = (msg) => {
  if (msg.type === "scan") {
    runScan();
  }
};

// ============================================================
// THE SCAN ENGINE
// ============================================================

function runScan() {
  // Get whatever the designer has selected on the canvas
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    // Nothing selected — tell the UI to show an error
    figma.ui.postMessage({
      type: "error",
      message: "Select a frame to scan",
    });
    return;
  }

  // We scan the first selected node (and everything inside it)
  const root = selection[0];

  // Collect every node inside the selection into a flat list.
  // This makes it easy to loop through everything for each check.
  const allNodes = collectAllNodes(root);

  // Run each of the 13 checks
  const results = [
    checkDescriptions(allNodes),
    checkLayerNaming(allNodes),
    checkComponentProperties(allNodes),
    checkCodeConnect(allNodes),
    checkAutoLayout(allNodes),
    checkTokenUsage(allNodes),
    checkRealContent(allNodes),
    checkStateCompleteness(allNodes),
    checkComponentCoverage(allNodes),
    checkNamingConsistency(allNodes),
    checkHierarchy(allNodes, root),
    checkPageOrganisation(),
    checkAccessibleOutput(allNodes),
  ];

  // Send results back to the UI for display
  figma.ui.postMessage({
    type: "results",
    data: results,
  });
}

// ============================================================
// HELPER: Collect all nodes into a flat array
// ============================================================
// Figma files are a tree (frames inside frames inside frames).
// This function walks the whole tree and returns a flat list
// so we can easily loop through every node.

function collectAllNodes(node) {
  const nodes = [node];
  if ("children" in node) {
    for (const child of node.children) {
      nodes.push(...collectAllNodes(child));
    }
  }
  return nodes;
}

// ============================================================
// HELPER: Get the path of a node (e.g. "hero / content / heading")
// ============================================================

function getPath(node) {
  const parts = [];
  let current = node;
  while (current && current.type !== "PAGE") {
    parts.unshift(current.name);
    current = current.parent;
  }
  return parts.join(" / ");
}

// ============================================================
// CHECK 1: DESCRIPTION COVERAGE (Critical — weight 5)
// ============================================================
// Components and component sets have a "description" field.
// If it's empty, an agent has no idea what the component is for.

function checkDescriptions(nodes) {
  const components = nodes.filter(
    (n) => n.type === "COMPONENT" || n.type === "COMPONENT_SET"
  );
  const total = components.length;
  const missing = [];

  for (const comp of components) {
    if (!comp.description || comp.description.trim() === "") {
      missing.push({
        layer: comp.name,
        path: getPath(comp),
        fix: "Add a description explaining when and how to use this component",
      });
    }
  }

  const score = total === 0 ? 100 : Math.round(((total - missing.length) / total) * 100);

  return {
    id: "descriptions",
    label: "DESCRIPTIONS",
    score,
    issues: missing.length,
    impact: "critical",
    weight: 5,
    description:
      "The closest thing to talking directly to an agent. Without descriptions, it guesses at intent — and guesses wrong.",
    details: missing.slice(0, 8), // Show max 8 to keep the UI manageable
  };
}

// ============================================================
// CHECK 2: LAYER NAMING (Critical — weight 5)
// ============================================================
// Figma auto-names layers "Frame 1", "Group 3", "Rectangle 7".
// These mean nothing to an agent. We flag any that match
// the default naming pattern.

function checkLayerNaming(nodes) {
  // These patterns match Figma's auto-generated names
  const defaultNamePattern = /^(Frame|Group|Rectangle|Ellipse|Line|Vector|Polygon|Star|Boolean|Slice|Image|Text)\s*\d*$/i;

  const bad = [];
  for (const node of nodes) {
    if (defaultNamePattern.test(node.name.trim())) {
      bad.push({
        layer: node.name,
        path: getPath(node),
        fix: "Rename to describe its purpose (e.g. 'hero-heading', 'nav-divider')",
      });
    }
  }

  const total = nodes.length;
  const score = total === 0 ? 100 : Math.round(((total - bad.length) / total) * 100);

  return {
    id: "naming",
    label: "LAYER NAMING",
    score,
    issues: bad.length,
    impact: "critical",
    weight: 5,
    description:
      "Every unnamed layer is an unmarked door. 'Frame 247' means nothing. 'hero-heading-group' means everything.",
    details: bad.slice(0, 8),
  };
}

// ============================================================
// CHECK 3: COMPONENT PROPERTIES (Critical — weight 4)
// ============================================================
// Modern Figma components can have boolean properties,
// instance swap properties, and text properties. These are
// structured data an agent can read. Without them, the agent
// sees a wall of variants with no structure.

function checkComponentProperties(nodes) {
  const componentSets = nodes.filter((n) => n.type === "COMPONENT_SET");
  const components = nodes.filter(
    (n) => n.type === "COMPONENT" && n.parent && n.parent.type !== "COMPONENT_SET"
  );
  // Only check top-level components and component sets
  const checkable = [...componentSets, ...components];
  const total = checkable.length;
  const missing = [];

  for (const comp of checkable) {
    // componentPropertyDefinitions exists on COMPONENT_SET and COMPONENT
    const props = comp.componentPropertyDefinitions;
    if (!props || Object.keys(props).length === 0) {
      missing.push({
        layer: comp.name,
        path: getPath(comp),
        fix: "Add boolean, text, or instance swap properties",
      });
    }
  }

  const score = total === 0 ? 100 : Math.round(((total - missing.length) / total) * 100);

  return {
    id: "properties",
    label: "COMPONENT PROPS",
    score,
    issues: missing.length,
    impact: "critical",
    weight: 4,
    description:
      "Boolean props, instance swaps, and text props are structured data. Variant grids without properties are noise.",
    details: missing.slice(0, 8),
  };
}

// ============================================================
// CHECK 4: CODE CONNECT (Critical — weight 4)
// ============================================================
// Code Connect maps Figma component props to actual code props.
// Without it, an agent sees Figma's naming ("Type=Primary",
// "State=Hover") and has to guess how that maps to code
// ("variant='primary'", CSS pseudo-class). With Code Connect,
// the agent sees the exact code to write. This eliminates an
// entire category of hallucination.

function checkCodeConnect(nodes) {
  // Get all components and component sets — these are what
  // Code Connect attaches to
  const componentSets = nodes.filter((n) => n.type === "COMPONENT_SET");
  const standaloneComponents = nodes.filter(
    (n) => n.type === "COMPONENT" && n.parent && n.parent.type !== "COMPONENT_SET"
  );
  const checkable = [...componentSets, ...standaloneComponents];
  const total = checkable.length;
  const notConnected = [];

  for (const comp of checkable) {
    // Code Connect stores mapping data in Figma's shared plugin data
    // under specific namespaces. We check multiple known namespaces
    // because the storage location has evolved across versions.
    // We also check dev resources and dev status as lighter-weight
    // alternatives that still help agents bridge design → code.
    let hasCodeConnect = false;

    // Check the namespaces where Code Connect stores its mappings.
    // "figma" is the official namespace for Figma-owned features
    // including Code Connect. We also check "code_connect" and
    // "codegen" as fallback namespaces used by earlier versions.
    const namespacesToCheck = ["figma", "code_connect", "codegen"];

    for (const ns of namespacesToCheck) {
      if (hasCodeConnect) break;
      try {
        const keys = comp.getSharedPluginDataKeys(ns);
        if (keys && keys.length > 0) {
          hasCodeConnect = true;
        }
      } catch (e) {
        // getSharedPluginDataKeys may not be available in all contexts
      }
    }

    // Check for dev resources (links to source code files).
    // These are a lighter-weight alternative to full Code Connect
    // but still give agents a path from component → code.
    if (!hasCodeConnect) {
      try {
        const devResources = comp.devResources;
        if (devResources && devResources.length > 0) {
          hasCodeConnect = true;
        }
      } catch (e) {
        // devResources may not be available in older API versions
      }
    }

    // Check dev status — components marked as "READY_FOR_DEV"
    // in Dev Mode indicate some level of design-to-code bridging,
    // even without full Code Connect setup.
    if (!hasCodeConnect) {
      try {
        if (comp.devStatus && comp.devStatus.type === "READY_FOR_DEV") {
          hasCodeConnect = true;
        }
      } catch (e) {
        // devStatus may not be available
      }
    }

    if (!hasCodeConnect) {
      notConnected.push({
        layer: comp.name,
        path: getPath(comp),
        fix: "Set up Code Connect to map Figma props to code props",
      });
    }
  }

  const score = total === 0 ? 100 : Math.round(((total - notConnected.length) / total) * 100);

  return {
    id: "codeconnect",
    label: "CODE CONNECT",
    score,
    issues: notConnected.length,
    impact: "critical",
    weight: 4,
    description:
      "Code Connect maps Figma props to real code props. Without it, agents guess that 'Type=Primary' means variant='primary'. With it, they know.",
    details: notConnected.slice(0, 8),
  };
}

// ============================================================
// CHECK 5: AUTO-LAYOUT COVERAGE (High — weight 3)
// ============================================================
// Frames with auto-layout encode structural intent (row, column,
// wrap). Frames without it are just absolute coordinates — an
// agent has no idea why something is positioned where it is.

function checkAutoLayout(nodes) {
  // Only check frames (not text, not shapes)
  const frames = nodes.filter(
    (n) => n.type === "FRAME" || n.type === "COMPONENT" || n.type === "INSTANCE"
  );
  // Frames that have children but no auto-layout
  const noLayout = [];

  for (const frame of frames) {
    if ("children" in frame && frame.children.length > 1) {
      if (!frame.layoutMode || frame.layoutMode === "NONE") {
        noLayout.push({
          layer: frame.name,
          path: getPath(frame),
          fix: "Convert to auto-layout (vertical or horizontal)",
        });
      }
    }
  }

  const total = frames.filter((f) => "children" in f && f.children.length > 1).length;
  const score = total === 0 ? 100 : Math.round(((total - noLayout.length) / total) * 100);

  return {
    id: "autolayout",
    label: "AUTO-LAYOUT",
    score,
    issues: noLayout.length,
    impact: "high",
    weight: 3,
    description:
      "Auto-layout encodes intent — row, stack, wrap. Absolute positioning is just coordinates with no meaning.",
    details: noLayout.slice(0, 8),
  };
}

// ============================================================
// CHECK 6: TOKEN USAGE (High — weight 3)
// ============================================================
// When colours and text styles use Figma styles/variables,
// agents can understand the ROLE (brand/primary) not just
// the VALUE (#3B82F6). We check for fills, strokes, text
// styles, and effects that aren't linked to a style.

function checkTokenUsage(nodes) {
  const issues = [];

  for (const node of nodes) {
    // Check fill styles
    if ("fillStyleId" in node && "fills" in node) {
      const fills = node.fills;
      if (
        Array.isArray(fills) &&
        fills.length > 0 &&
        fills.some((f) => f.type === "SOLID" && f.visible !== false) &&
        (!node.fillStyleId || node.fillStyleId === "")
      ) {
        // Has a visible solid fill but no style linked
        // Skip if it's inside a component (inherits from parent)
        if (node.type !== "INSTANCE") {
          issues.push({
            layer: node.name,
            path: getPath(node),
            fix: "Link fill to a colour style or variable",
          });
        }
      }
    }

    // Check stroke styles
    if ("strokeStyleId" in node && "strokes" in node) {
      const strokes = node.strokes;
      if (
        Array.isArray(strokes) &&
        strokes.length > 0 &&
        strokes.some((s) => s.type === "SOLID" && s.visible !== false) &&
        (!node.strokeStyleId || node.strokeStyleId === "")
      ) {
        if (node.type !== "INSTANCE") {
          issues.push({
            layer: node.name,
            path: getPath(node),
            fix: "Link stroke to a colour style or variable",
          });
        }
      }
    }

    // Check effect styles (shadows, blurs)
    if ("effectStyleId" in node && "effects" in node) {
      const effects = node.effects;
      if (
        Array.isArray(effects) &&
        effects.length > 0 &&
        effects.some((e) => e.visible !== false) &&
        (!node.effectStyleId || node.effectStyleId === "")
      ) {
        if (node.type !== "INSTANCE") {
          issues.push({
            layer: node.name,
            path: getPath(node),
            fix: "Link effect to an effect style (e.g. 'elevation/md')",
          });
        }
      }
    }

    // Check text styles
    if (node.type === "TEXT") {
      if (!node.textStyleId || node.textStyleId === "") {
        issues.push({
          layer: node.name,
          path: getPath(node),
          fix: "Link to a text style (e.g. 'body/default', 'heading/h2')",
        });
      }
    }
  }

  const total = nodes.filter(
    (n) =>
      ("fillStyleId" in n && Array.isArray(n.fills) && n.fills.length > 0) ||
      ("strokeStyleId" in n && Array.isArray(n.strokes) && n.strokes.length > 0) ||
      ("effectStyleId" in n && Array.isArray(n.effects) && n.effects.length > 0) ||
      n.type === "TEXT"
  ).length;
  const score = total === 0 ? 100 : Math.round(((total - issues.length) / total) * 100);

  return {
    id: "tokens",
    label: "TOKEN USAGE",
    score: Math.max(0, Math.min(100, score)),
    issues: issues.length,
    impact: "high",
    weight: 3,
    description:
      "'brand/primary' has meaning. #3B82F6 doesn't. Agents generate maintainable code only when they understand roles.",
    details: issues.slice(0, 8),
  };
}

// ============================================================
// CHECK 7: REAL CONTENT (High — weight 3)
// ============================================================
// Lorem ipsum and placeholder text mislead agents. They name
// functions and variables based on what they think the UI does.

function checkRealContent(nodes) {
  const textNodes = nodes.filter((n) => n.type === "TEXT");
  const placeholderPatterns = [
    // Latin filler text
    /lorem\s+ipsum/i,
    /dolor\s+sit\s+amet/i,
    /consectetur\s+adipiscing/i,
    // Generic placeholder words
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
    // Placeholder values
    /^\$0\.00$/,
    /^0\.00$/,
    /^XX+$/,
    /^---+$/,
    /^\.\.\.$/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,           // MM/DD/YYYY date placeholders
    /^(MM|DD|YYYY|mm|dd|yyyy)[\/\-](MM|DD|YYYY|mm|dd|yyyy)[\/\-](MM|DD|YYYY|mm|dd|yyyy)$/i,
    /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(2000|0000)$/,  // 01/01/2000 style
    // Placeholder contact info
    /^(email|name|user|first\.?name|last\.?name)@(example|company|test|domain)\.(com|org|net)$/i,
    /^(555|000|123)[\s\-]?\d{3}[\s\-]?\d{4}$/,  // Fake phone numbers
    /^(123|000)\s*(main|any|fake)\s*(st|street|ave|road)/i,  // Fake addresses
    // Common Figma/design tool defaults
    /^(first|last)\s*name$/i,
    /^(email|phone)\s*address$/i,
    /^(user|display)\s*name$/i,
    /^(company|org)\s*name$/i,
  ];

  const bad = [];
  for (const t of textNodes) {
    // Get the text characters
    const text = t.characters || "";
    if (text.trim() === "") continue;

    for (const pattern of placeholderPatterns) {
      if (pattern.test(text.trim())) {
        bad.push({
          layer: text.length > 40 ? text.substring(0, 40) + "..." : text,
          path: getPath(t),
          fix: "Replace with real content that describes what this element does",
        });
        break;
      }
    }
  }

  const total = textNodes.length;
  const score = total === 0 ? 100 : Math.round(((total - bad.length) / total) * 100);

  return {
    id: "content",
    label: "REAL CONTENT",
    score,
    issues: bad.length,
    impact: "high",
    weight: 3,
    description:
      "Lorem ipsum actively misleads. Agents name functions based on what they think the UI does. Real content = accurate code.",
    details: bad.slice(0, 8),
  };
}

// ============================================================
// CHECK 8: STATE COMPLETENESS (High — weight 3)
// ============================================================
// Interactive components should have multiple states (default,
// hover, disabled, focused, etc.). We check component sets for
// common state-related variant properties.

function checkStateCompleteness(nodes) {
  const componentSets = nodes.filter((n) => n.type === "COMPONENT_SET");
  const missing = [];
  const expectedStates = ["hover", "pressed", "disabled", "focused", "loading", "error", "active"];

  for (const set of componentSets) {
    // Look at the variant names to find state-like properties
    const children = set.children || [];
    const allVariantProps = new Set();

    for (const child of children) {
      // Variant names look like "State=Default, Size=MD"
      const name = child.name || "";
      const pairs = name.split(",").map((p) => p.trim().toLowerCase());
      for (const pair of pairs) {
        const [, value] = pair.split("=").map((s) => (s || "").trim());
        if (value) allVariantProps.add(value);
      }
    }

    // Check if any expected states are present
    const foundStates = expectedStates.filter((s) => allVariantProps.has(s));
    const isInteractive =
      set.name.toLowerCase().includes("button") ||
      set.name.toLowerCase().includes("input") ||
      set.name.toLowerCase().includes("link") ||
      set.name.toLowerCase().includes("tab") ||
      set.name.toLowerCase().includes("toggle") ||
      set.name.toLowerCase().includes("checkbox") ||
      set.name.toLowerCase().includes("radio") ||
      set.name.toLowerCase().includes("select");

    if (isInteractive && foundStates.length < 3) {
      const missingStates = expectedStates
        .filter((s) => !allVariantProps.has(s))
        .slice(0, 3);
      missing.push({
        layer: set.name,
        path: getPath(set),
        fix: `Missing states: ${missingStates.join(", ")}`,
      });
    }
  }

  const interactiveTotal = componentSets.filter((set) => {
    const name = set.name.toLowerCase();
    return ["button", "input", "link", "tab", "toggle", "checkbox", "radio", "select"].some((k) =>
      name.includes(k)
    );
  }).length;

  const score =
    interactiveTotal === 0
      ? 100
      : Math.round(((interactiveTotal - missing.length) / interactiveTotal) * 100);

  return {
    id: "states",
    label: "STATE COVERAGE",
    score,
    issues: missing.length,
    impact: "high",
    weight: 3,
    description:
      "Missing states force agents to hallucinate hover, disabled, loading, error — or skip them. Both costly.",
    details: missing.slice(0, 8),
  };
}

// ============================================================
// CHECK 9: COMPONENT COVERAGE (Moderate — weight 2)
// ============================================================
// How much of the design uses proper components (instances)
// vs raw shapes? Components carry metadata; raw shapes don't.

function checkComponentCoverage(nodes) {
  const instances = nodes.filter((n) => n.type === "INSTANCE");

  // Only flag raw shapes that are NOT inside a component or instance.
  // Shapes inside components are already part of a componentised
  // structure — they're the building blocks, not the problem.
  // We only care about loose shapes at the frame/page level.
  function isInsideComponent(node) {
    let current = node.parent;
    while (current && current.type !== "PAGE") {
      if (current.type === "COMPONENT" || current.type === "COMPONENT_SET" || current.type === "INSTANCE") {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  const rawShapes = nodes.filter((n) =>
    ["RECTANGLE", "ELLIPSE", "POLYGON", "STAR", "LINE", "VECTOR"].includes(n.type) &&
    !isInsideComponent(n)
  );
  const total = instances.length + rawShapes.length;
  const score = total === 0 ? 100 : Math.round((instances.length / total) * 100);

  const details = rawShapes.slice(0, 8).map((s) => ({
    layer: `${s.type.toLowerCase()} "${s.name}"`,
    path: getPath(s),
    fix: "Consider replacing with a component if this is a reusable element",
  }));

  return {
    id: "components",
    label: "COMPONENTS",
    score,
    issues: rawShapes.length,
    impact: "moderate",
    weight: 2,
    description:
      "Components carry metadata. A raw rectangle is opaque — the agent can't tell it's a button.",
    details,
  };
}

// ============================================================
// CHECK 10: NAMING CONSISTENCY (Moderate — weight 2)
// ============================================================
// Checks for mixed naming conventions in variant properties,
// e.g. sm vs small vs S in the same file.

function checkNamingConsistency(nodes) {
  const componentSets = nodes.filter((n) => n.type === "COMPONENT_SET");
  const issues = [];

  // Collect all property values across all component sets
  const propValues = {}; // { propertyName: Set of values }

  for (const set of componentSets) {
    const children = set.children || [];
    for (const child of children) {
      const pairs = (child.name || "").split(",").map((p) => p.trim());
      for (const pair of pairs) {
        const [key, value] = pair.split("=").map((s) => (s || "").trim());
        if (key && value) {
          if (!propValues[key]) propValues[key] = new Set();
          propValues[key].add(value);
        }
      }
    }
  }

  // Look for inconsistencies: size having both "sm" and "Small"
  const sizePatterns = { short: /^(xs|sm|md|lg|xl|xxl)$/i, long: /^(small|medium|large|extra)/i };

  for (const [prop, values] of Object.entries(propValues)) {
    const vals = Array.from(values);
    const hasShort = vals.some((v) => sizePatterns.short.test(v));
    const hasLong = vals.some((v) => sizePatterns.long.test(v));
    if (hasShort && hasLong) {
      issues.push({
        layer: `${prop}: ${vals.join(", ")}`,
        path: "Variant properties",
        fix: `Standardise ${prop} values to one convention (e.g. sm/md/lg)`,
      });
    }

    // Check for mixed case: "Primary" and "primary"
    const lowerVals = vals.map((v) => v.toLowerCase());
    const uniqueLower = new Set(lowerVals);
    if (uniqueLower.size < vals.length) {
      issues.push({
        layer: `${prop}: ${vals.join(", ")}`,
        path: "Variant properties",
        fix: `Fix inconsistent casing in ${prop} values`,
      });
    }
  }

  const total = Object.keys(propValues).length;
  const score = total === 0 ? 100 : Math.round(((total - issues.length) / total) * 100);

  return {
    id: "consistency",
    label: "CONSISTENCY",
    score: Math.max(0, score),
    issues: issues.length,
    impact: "moderate",
    weight: 2,
    description:
      "Mixed conventions (sm/small/S) create ambiguity. The agent picks one — maybe not yours.",
    details: issues.slice(0, 8),
  };
}

// ============================================================
// CHECK 11: HIERARCHY LEGIBILITY (Moderate — weight 2)
// ============================================================
// Deeply nested layers are hard for agents to parse. We flag
// any node more than 8 levels deep from the selection root.

function checkHierarchy(nodes, root) {
  const MAX_DEPTH = 8;
  const deep = [];

  function measureDepth(node, depth) {
    if (depth > MAX_DEPTH) {
      deep.push({
        layer: node.name,
        path: getPath(node),
        fix: `Nested ${depth} levels deep — flatten to reduce complexity`,
      });
    }
    if ("children" in node) {
      for (const child of node.children) {
        measureDepth(child, depth + 1);
      }
    }
  }

  measureDepth(root, 0);

  const score = nodes.length === 0 ? 100 : Math.round(((nodes.length - deep.length) / nodes.length) * 100);

  return {
    id: "hierarchy",
    label: "HIERARCHY",
    score,
    issues: deep.length,
    impact: "moderate",
    weight: 2,
    description:
      "Agents read the tree, not the pixels. Deep nesting obscures relationships.",
    details: deep.slice(0, 8),
  };
}

// ============================================================
// CHECK 12: PAGE ORGANISATION (Moderate — weight 2)
// ============================================================
// This one looks at the whole file, not just the selection.
// A single page with hundreds of frames is hard for agents.

function checkPageOrganisation() {
  const pages = figma.root.children;
  const pageCount = pages.length;
  const currentPage = figma.currentPage;
  const topLevelFrames = currentPage.children.length;

  const issues = [];

  if (pageCount === 1 && topLevelFrames > 30) {
    issues.push({
      layer: `${currentPage.name} (${topLevelFrames} top-level frames)`,
      path: `/ ${currentPage.name}`,
      fix: "Split into pages: Foundations, Components, Patterns, Screens",
    });
  }

  // Score: 1 page with lots of frames is bad, multiple pages is better
  let score = 100;
  if (pageCount === 1 && topLevelFrames > 50) score = 30;
  else if (pageCount === 1 && topLevelFrames > 30) score = 50;
  else if (pageCount === 1 && topLevelFrames > 15) score = 70;
  else if (pageCount >= 3) score = 100;
  else if (pageCount === 2) score = 85;

  return {
    id: "pages",
    label: "PAGE STRUCTURE",
    score,
    issues: issues.length,
    impact: "moderate",
    weight: 2,
    description:
      "One giant page with 400 frames is a wall of noise that burns tokens and time.",
    details: issues,
  };
}

// ============================================================
// CHECK 13: ACCESSIBLE OUTPUT (Output quality — weight 2)
// ============================================================
// This checks whether the file gives agents enough information
// to produce accessible code: descriptions mentioning roles,
// reading order annotations, etc.

function checkAccessibleOutput(nodes) {
  const frames = nodes.filter(
    (n) => n.type === "FRAME" || n.type === "COMPONENT" || n.type === "INSTANCE"
  );
  const issues = [];

  // Check if any top-level sections have descriptions about roles/a11y
  const a11yKeywords = /role|landmark|aria|focus|tab.?order|reading.?order|accessible|screen.?reader|semantic/i;

  for (const frame of frames) {
    // Only check frames that look like sections (direct children of root or large frames)
    if (
      frame.parent &&
      (frame.parent.type === "PAGE" || frame.parent.type === "FRAME") &&
      frame.width > 200 &&
      frame.height > 100
    ) {
      const desc = frame.description || "";
      if (!a11yKeywords.test(desc) && !a11yKeywords.test(frame.name)) {
        // Only flag the first few — this would be noisy otherwise
        if (issues.length < 8) {
          issues.push({
            layer: frame.name,
            path: getPath(frame),
            fix: "Add annotation: landmark role, reading order, or focus behaviour",
          });
        }
      }
    }
  }

  const sectionFrames = frames.filter(
    (f) =>
      f.parent &&
      (f.parent.type === "PAGE" || f.parent.type === "FRAME") &&
      f.width > 200 &&
      f.height > 100
  ).length;

  const annotated = sectionFrames - issues.length;
  const score = sectionFrames === 0 ? 100 : Math.round((annotated / sectionFrames) * 100);

  return {
    id: "a11y",
    label: "ACCESSIBLE OUTPUT",
    score: Math.max(0, score),
    issues: issues.length,
    impact: "output",
    weight: 2,
    description:
      "Without landmarks and focus hints, agents produce inaccessible code at scale. This is about what the agent builds.",
    details: issues.slice(0, 8),
  };
}

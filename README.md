# Agent Ready

**Your design file is probably not ready for AI agents. Here's how to tell, and what to do about it.**

When an AI coding agent reads a Figma file through MCP, it sees a very
different thing than you do. It sees unnamed layers called "Frame 247",
empty component descriptions, raw hex values where tokens should be,
and missing states. Each gap forces it to guess. The guesses compound.
The code comes out messy, generic, or quietly wrong — and most of the
time, you blame the agent.

Agent Ready is built around one claim: **design files need to be
agent-readable now, or agent collaboration produces bad outputs.**
This repo contains two things that address that claim from two
different directions.

By MC Dean · [Percolates on Substack](https://marieclairedean.substack.com)

---

## What this repo contains

```
agent-ready-plugin/
├── SKILL.md        — the agent skill (the real product)
├── GEMINI.md       — the same skill for Gemini CLI
├── shared/         — executable checks the skill can run against raw Figma JSON
├── manifest.json   — the Figma plugin (the educational on-ramp)
├── code.js         — the plugin scan engine
├── ui.html         — the plugin UI
└── README.md       — you're here
```

There are two tools here, but they are not equal.

**The skill is the real product.** It's what actually raises the
ceiling of what an agent can produce from a messy Figma file. It runs
inside your coding agent (Claude Code, Gemini CLI, and more soon),
silently assesses every file the agent reads, and compensates for
gaps before generating code. It emits a structured evidence block at
the top of every file it produces so a human reviewer can audit what
the agent had to guess.

**The plugin is the educational on-ramp.** It's the thing that makes
a designer realise, visually, that their file isn't ready for agent
collaboration. You run it inside Figma, see a score, see the specific
gaps, and get a prioritised fix list. That's its job. It's not where
the long-term value lives.

If you only install one, install the skill.

---

## The Skill

Agent Ready ships as an instruction file for your coding agent. It
runs the same 13 agent-readiness checks conceptually — but instead of
showing a visual score, it changes how the agent reads and interprets
the file, and writes its assumptions down in a form you can audit.

### What it does, invisibly

When you ask your agent to implement a Figma design, the skill fires
automatically. It:

- Reads the file context through your Figma MCP server.
- Runs 13 checks across four impact tiers (see below).
- Compensates for gaps silently — infers names from context, resolves
  tokens from the design system, adds missing states, parses variant
  strings for props.
- Emits an `@agent-ready-report` comment block at the top of any code
  it produces, recording what it saw, what it had to guess, and how
  confident it is.

When you ask it directly — *"How agent-ready is this file?"* — it
produces a full readiness report with scores, critical gaps, and
recommendations.

### What it checks (ordered by agent impact)

**Critical impact** — these fundamentally change agent output:

- **Description coverage and quality** — Do components explain their
  purpose, not just their appearance?
- **Layer naming** — Are layers named, or still "Frame 247"?
- **Component properties** — Boolean, text, and instance-swap props?
- **Code Connect bridge** — Are Figma props mapped to real code props,
  or is the file claiming a bridge to production that doesn't exist?

**High impact** — significantly improves agent comprehension:

- **Auto-layout** — Does the structure encode layout intent?
- **Token binding** — Not whether tokens exist, but whether they're
  actually *attached* to fills, strokes, and text. An unbound token
  is invisible to the agent.
- **Real content** — Or is it full of lorem ipsum and "Label"?
- **State completeness** — Are hover, disabled, error, and loading
  states defined?

**Moderate impact** — reduces errors and waste:

- **Component coverage** — Instances vs raw shapes.
- **Naming consistency** — sm/small/S or one of them?
- **Hierarchy depth** — Flat enough to reflect DOM intent?
- **Page organisation** — One massive page or logical sections?

**Output quality** — affects what the agent builds:

- **Accessibility annotations** — Landmarks, roles, focus behaviour.

### v0.3.0: executable verification, end to end

As of v0.3.0, the skill ships with a shared JavaScript module
(`shared/checks.js`, `shared/report.js`) that implements all 13
checks as pure functions — description coverage *and* quality
(ported as two separate functions so quality is scored
independently from presence), layer naming, component properties,
Code Connect, auto-layout, token binding, real content, state
completeness, component coverage, naming consistency, hierarchy
depth, page organisation, and accessibility annotations. When the
agent has the raw Figma node tree in JSON, it runs the checks for
real instead of eyeballing them, and produces the same scores the
plugin does for the same file. The prose-only tier has been retired.

The module also generates the `@agent-ready-report` block — the
structured comment the agent pastes at the top of any code it
produces. That block is the evidence trail. It tells a reviewer
what the agent saw, what it had to guess, and how confident it is.

### Install

#### Claude Code → `SKILL.md`

Copy `SKILL.md` into `.claude/skills/agent-ready/` in your project,
or into `~/.claude/skills/agent-ready/` to make it available globally.
Claude Code auto-triggers the skill based on its description
frontmatter — natural language works:

- "How agent-ready is this Figma file?"
- "Assess this design before generating code"
- "Implement this design as a React component" *(triggers silently)*

#### Gemini CLI → `GEMINI.md`

Copy `GEMINI.md` into the root of your project, or into
`~/.gemini/GEMINI.md` to apply globally across all projects. Gemini
CLI auto-loads `GEMINI.md` files as persistent instructions when you
run `gemini` in that folder — no command needed.

#### Cursor, Codex, Windsurf — coming soon

Adapter files for other coding agents are planned. If you use one of
these and want support sooner, please [open an issue](https://github.com/Owl-Listener/agent-ready/issues) —
it'll help me prioritise.

### Requires

A Figma MCP server providing `get_design_context`, `use_figma`, and
`search_design_system`. If these aren't available, the skill will
tell the user what to connect.

---

## The Plugin (the educational on-ramp)

The plugin is how a designer who doesn't yet work with coding agents
finds out their files aren't ready. It runs inside Figma, scans the
frame you selected, gives you a score, and shows you exactly which
components, layers, and tokens are letting the side down. That
moment — the first time you see a 34/100 on a file you thought was
clean — is the whole point. Once you've had it, the skill becomes
the tool you actually use.

The plugin is frozen at v0.1.0. It will keep working, but the
long-term development effort is in the skill.

### Install (3 minutes)

You need the **Figma desktop app** (not the browser version) to run
local plugins.

1. Download or clone this folder to your computer
2. Open any Figma file
3. Go to: **Plugins → Development → Import plugin from manifest…**
4. Navigate to the `agent-ready-plugin` folder and select `manifest.json`
5. Click **Open**

Or...coming soon: install it from [Figma Community](https://www.figma.com/community/plugin/1625957032362797490)
(published — no setup needed).

### Run it

1. Select a frame on your canvas
2. Go to: **Plugins → Development → Agent Ready** (or just **Plugins → Agent Ready** if installed from Community)
3. Click **Scan Frame**
4. See your score and fix suggestions
5. Export a markdown report to share with your team

### Tips

- **Start with descriptions.** One sentence per component explaining
  purpose (not appearance) is the single highest-impact thing you
  can do.
- **Fix naming in batches.** Fifteen minutes renaming the children
  of one frame makes a measurable difference.
- **Then install the skill.** Once the plugin has shown you the
  gap, the skill is what closes it.

---

## Contributing

Agent Ready is open source under Owl-Listener. Fork it, break it,
make it better. If you add a check, keep the impact-tier ordering
and weighting — it's what makes the score reflect how an agent
actually experiences the file.

`SKILL.md` is the canonical source for the check logic. If you edit
checks, update `SKILL.md` and `GEMINI.md` together so the two entry
points stay consistent.

---

## License

MIT

# Agent Ready

**Is your design file ready for AI agents?**

Agent Ready scans your Figma file and scores how well an AI agent
can read, understand, and act on it. 13 checks across 4 impact tiers,
with specific fix suggestions for every issue found.

This repo contains two tools that work together:

- **A Figma plugin** that talks to humans — run it, see a score, fix issues.
- **An agent skill** that talks to AI agents (Claude Code, Gemini CLI, Cursor, Codex, Windsurf) — it assesses file quality and compensates for gaps before generating code.

The plugin raises the floor of file quality from the human side.
The skill raises the ceiling of what agents can produce from the agent side.
Together, they close the gap from both directions.

By MC Dean · [Percolates on Substack](https://marieclairedean.substack.com)

---

## What's in the box

```
agent-ready-plugin/
├── manifest.json   — tells Figma this is a plugin
├── code.js         — the scan engine (runs inside Figma's sandbox)
├── ui.html         — the panel UI you interact with
├── SKILL.md        — the MCP skill for AI agents
└── README.md       — you're here
```

---

## The Plugin

### Install (3 minutes)

You need the **Figma desktop app** (not the browser version)
to run local plugins.

1. Download or clone this folder to your computer
2. Open any Figma file
3. Go to: **Plugins → Development → Import plugin from manifest…**
4. Navigate to the `agent-ready-plugin` folder and select `manifest.json`
5. Click **Open**

That's it. The plugin is installed locally.

### Run it

1. Select a frame on your canvas
2. Go to: **Plugins → Development → Agent Ready**
3. The panel opens. Click **Scan Frame**
4. See your score and fix suggestions

### What it checks (ordered by agent impact)

**Critical Impact** — these fundamentally change agent output:

- **Descriptions** — Do components explain what they're for?
- **Layer Naming** — Are layers named, or still "Frame 247"?
- **Component Props** — Are there boolean/text/swap properties?
- **Code Connect** — Are Figma props mapped to code props?

**High Impact** — significantly improves comprehension:

- **Auto-layout** — Does the structure encode intent?
- **Token Usage** — Are colours, strokes, and effects linked to styles?
- **Real Content** — Or is it full of lorem ipsum and placeholder data?
- **State Coverage** — Are hover/disabled/error/loading defined?

**Moderate Impact** — reduces errors and waste:

- **Components** — How much uses components vs loose raw shapes?
- **Consistency** — Are naming conventions uniform?
- **Hierarchy** — Is the nesting logical and shallow?
- **Page Structure** — Is the file organised into pages?

**Output Quality** — affects what the agent builds, not what it reads:

- **Accessible Output** — Will the agent's code be accessible?

### How the score works

Each check produces a 0–100 score. The overall score is a
**weighted average** — critical checks count 2.5× more than
moderate ones. A file with perfect hierarchy but empty descriptions
still gets a bad score, because that matches how an agent actually
experiences the file.

### Tips

- **Start with Descriptions.** One sentence per component is the
  single highest-impact thing you can do.
- **Fix naming in batches.** Select a frame, rename its children
  with meaningful names. Even 15 minutes makes a big difference.
- **Export your report.** The Export button copies a markdown report
  to your clipboard — paste it into a doc or Slack to share with
  your team.

---

## For AI agents

Agent Ready ships with instruction files that teach AI coding agents
to assess a Figma file's readiness *before* generating code, and to
compensate for gaps they find. The agent runs the same 13 checks
conceptually, but instead of showing a visual score, it adjusts how
it reads and interprets the file.

When generating code, the agent works silently — inferring names,
resolving tokens, flagging where it had to guess. When asked
directly ("How agent-ready is this file?"), it produces a full
readiness report with scores and recommendations.

Each supported agent has its own instruction file, because every
agent has a different convention for where persistent instructions
live. Both files contain the same core content (the 13 checks, the
compensation patterns, the examples) — they differ only in framing
and install location.

### Claude Code → `SKILL.md`

Copy `SKILL.md` into `.claude/skills/agent-ready/` in your project,
or into `~/.claude/skills/agent-ready/` to make it available globally.
Claude Code auto-triggers the skill based on its description
frontmatter — natural language works:

- "How agent-ready is this Figma file?"
- "Assess this design before generating code"
- "Implement this design as a React component" *(triggers silently)*

### Gemini CLI → `GEMINI.md`

Copy `GEMINI.md` into the root of your project, or into
`~/.gemini/GEMINI.md` to apply globally across all projects. Gemini
CLI auto-loads `GEMINI.md` files as persistent instructions when you
run `gemini` in that folder — no command needed.

Unlike Claude Code skills, Gemini CLI doesn't trigger instructions
based on a description field, so `GEMINI.md` is always loaded when
you're in the project. The instructions are written to recognise
when they apply (Figma work, code generation from designs) and
otherwise stay out of your way.

### Cursor, Codex, Windsurf — coming soon

Adapter files for other coding agents are planned. If you use one
of these agents and want support sooner, please [open an issue](https://github.com/Owl-Listener/agent-ready/issues)
— it'll help me prioritise which to build next.

### Requires

Both files require a Figma MCP server providing `get_design_context`,
`use_figma`, and `search_design_system`. If these aren't available,
the agent will tell the user what to connect.

### Keeping files in sync

`SKILL.md` is the canonical source. If you fork this repo and edit
the checks, please update both `SKILL.md` and `GEMINI.md` together
so the two entry points stay consistent.

---

## Contributing

Agent Ready is open source under Owl-Listener. Fork it, break it,
make it better. If you add a check, keep the impact-tier ordering
and weight system — it's what makes the score meaningful.

---

## License

MIT

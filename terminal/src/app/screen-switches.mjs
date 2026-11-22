// Two of the screen's switches as plain values (rail.jsx and bot-layer.jsx draw what they pick; App.jsx and
// the slash commands set them): no React, no Ink, so the app's logic and its tests load them without the screen.

// /steps: grouped (the model's lines and their steps as task rows), open (every step: the default), words (no rows of
// steps, only what the model says). Open is the default since 22 Nov 2026 (the owner, on hearth: "all i see is,
// thinking... i need to see bash, commands, writes, using mcp tools"): grouped folded each finished step into a task row
// of one line, and on hearth, where a step thinks for up to a minute, the row under way mostly read THINKING.
export const STEPS = ['grouped', 'open', 'words'];
export const stepsOf = (v) => (STEPS.includes(v) ? v : 'open');
// The Visor bot (bot-layer.jsx): AGENTIC_BOT=off leaves it out (the app tests).
export const botAllowed = (env = process.env) => !/^(off|0|false|no)$/i.test(env.AGENTIC_BOT ?? '');

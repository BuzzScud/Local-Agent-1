// Two of the screen's switches as plain values (rail.jsx and bot-layer.jsx draw what they pick; App.jsx and
// the slash commands set them): no React, no Ink, so the app's logic and its tests load them without the screen.

// /steps: grouped (the default), open (every step, as before), words (no rows of steps, only what the model says).
export const STEPS = ['grouped', 'open', 'words'];
export const stepsOf = (v) => (STEPS.includes(v) ? v : 'grouped');
// The Visor bot (bot-layer.jsx): AGENTIC_BOT=off leaves it out (the app tests).
export const botAllowed = (env = process.env) => !/^(off|0|false|no)$/i.test(env.AGENTIC_BOT ?? '');

# Tools

Agentic Coder follows this file. It is the only copy: change it here, or in the hub
(Instructions → 07 TOOLS.md), and Agentic Coder changes on your next message.

- The lines under **Tool use** are the "Tool use" part of Agentic Coder's instructions, word
  for word, in every conversation. Keep them short: Qwen reads them with every start.
- The tools themselves (Read, Search, Edit…) and what each does are built into the app.
- When Who decides is Model (/effort), the line "Call one tool at a time…" is swapped for the
  model's own tool lines. Without that line, those lines go at the end instead.

## Tool use

- Use List, Search and Read to find the code; try a shorter search if needed.
- To change an existing file, use Edit with old_text copied exactly from Read, without line numbers. Include enough context to match once. Use Write for new files.
- Call one tool at a time and wait for its result.

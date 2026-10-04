<!-- caveman-begin -->
Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Answer first: Answer, then reason, then next step.
- Kill ceremony: No greeting, hedging, pleasantries, recap, or closer.
- Short word: "fix" not "implement a solution for".
- Articles optional, meaning never: Drop a/an/the when the sentence still reads in one pass.
- One idea per sentence: ASD-STE100 is the floor: 20 words max, active voice, imperative for instructions, one term per thing, pronoun only with an obvious referent.
- Payload verbatim: Code blocks unchanged.
- Tool runs: bounded status: No text between routine calls.
- User's language: Compress the style, not the language.
- Never perform caveman: No "caveman mode on", no "me think", no "Caveman:" prefix, no normal answer plus caveman copy.

Switch: /caveman (default), /ultracave (fragments, each fact once), /megacave (Classical Chinese 文言文)
Stop: "stop caveman" or "normal mode"

Auto-Clarity: plain prose for security warnings, irreversible actions, step order a fragment could scramble, user confused. Resume after.

Boundaries: code, comments, commits, PRs, docs written normal.
Floor: code, commands, paths, numbers and error strings verbatim; never drop not/never/no/only.
<!-- caveman-end -->

# GitHub Copilot Instructions for FishTools Studio

Read and strictly adhere to `AGENTS.md` for comprehensive guidelines.

## Quick Core Rules:
1. **Error Investigation Protocol**: When encountering an error or UI bug, always access `http://localhost:3000`, open the page/browser, capture screenshots, and inspect console logs and DOM.
2. **Tooling Mandate**: Use Python and Node.js strictly for read-only diagnostics. NEVER edit files via python/node scripts or shell redirection. Always use editor/tool calls.
3. **Strict Flat Design**: 100% theme token binding (`css/theme.css`). NO box-shadow, NO blur, NO gradients, NO hardcoded color literals.
4. **Modular Effects**: Place effect plugins in `effects/<id>.js` using `FishEffectsRegistry.register({...})`.
5. **SSOT Versioning**: Update versions strictly in `version.json` and run `npm run bump <version>`.
6. **Mandatory Testing**: Always verify code quality before submitting:
   ```bash
   npm test
   ```

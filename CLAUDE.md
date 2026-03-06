# CLAUDE.md

Read **DESIGN.md** before making changes. It documents the full project architecture:
component tree, API routes, data formats, state flow, and run instructions.

**Always update DESIGN.md** when you make any change that affects:
- File structure or the role of any file
- API routes, request/response shapes, or validation rules
- Component tree, shadow DOM structure, or cross-component event contracts
- App state machine or data flow
- CLI flags or run instructions
- Data formats stored on disk

Keep DESIGN.md accurate enough that a developer who hasn't seen the code
can understand how the whole system fits together without reading every file.

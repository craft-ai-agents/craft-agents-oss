# 020 - P3: Document Bidirectional Agent Feedback Loop for Flowy

**Status:** Pending
**Priority:** P3 (Nice-to-Have)
**Type:** Documentation
**Tags:** code-review, documentation, flowy, agent-native

## Problem

The Flowy skills (flowy-flowchart and flowy-ui-mockup) don't adequately document that Claude can see and respond to user edits in real-time. This is a powerful agent-native feature that enables interactive refinement, but users and developers may not understand the full capabilities.

## Locations

- `~/.vesper/global-skills/flowy-flowchart/` (skill definition and documentation)
- `~/.vesper/global-skills/flowy-ui-mockup/` (skill definition and documentation)
- Possibly: `docs/skills/flowy-*.md` (if documentation exists)

## Current Impact

- Users may not realize they can iteratively refine diagrams with Claude
- Developers extending Flowy may not understand the feedback loop architecture
- Full potential of agent-native diagram interaction is underutilized
- Documentation gap makes it harder for new users to adopt the feature

## Suggested Solution

Enhance documentation with clear examples and explanations:

1. **Skill README updates** - Add section on bidirectional feedback loop
   - Explain how Claude sees user edits
   - Show example workflow: User creates → Claude refines → User edits → Claude responds

2. **Example workflows** - Document common usage patterns
   - Iterative flowchart refinement
   - Mockup creation and modification
   - Collaborative design process

3. **Agent capabilities** - Document what Claude can do
   - Detect and understand user changes
   - Suggest improvements based on edits
   - Maintain context across iterations

4. **Technical documentation** - Explain the architecture
   - How diagrams are serialized/deserialized
   - How changes are detected
   - How feedback flows between user and agent

## Acceptance Criteria

- [ ] Flowy skills document the feedback loop clearly
- [ ] Example workflows included with before/after examples
- [ ] Agent capabilities and limitations documented
- [ ] New users can understand interactive refinement flow

## Notes

Lower priority documentation improvement. Valuable for user education and feature discoverability. Can be done incrementally.

## Work Log

- 2026-01-25: Created from code review
- 2026-01-25: Verified still valid - flowy-flowchart and flowy-ui-mockup skills exist but only briefly mention editing ("Edit the diagram by modifying the JSON"). No documentation of bidirectional feedback loop where Claude can see and respond to user edits. Issue remains pending.

# Storyboard Flow documentation

| Question | Entry |
| --- | --- |
| What is implemented and what remains? | Newest entries in [handoff](../context-handoff.md) and [todo](../todo.md) |
| Which rules apply before editing? | [AGENTS.md](../AGENTS.md); task-specific user authorization remains required |
| How does the existing production app work? | [System map](architecture/SYSTEM.md) and [decision history](../decisions.md) |
| Where is the new architecture being integrated? | [Refactor index](refactor/README.md) and [coordinator gates](refactor/wave2/COORDINATOR-GATES.md) |
| Which product and internal names should I use? | [Naming](architecture/NAMING.md) |
| How should synthetic filesystem fixtures be managed? | [Temporary workspaces](testing/temporary-workspaces.md) |
| How are releases prepared? | [Repository release](repository-release.md); documentation is not permission to publish |
| What can be cleaned up next? | [Cleanup review](maintenance/CLEANUP-REVIEW.md) |

Current guidance describes a maintained interface or workflow. Historical briefs describe
an assignment that ended; dated reviews preserve its candidate and evidence. Keep those
roles separate: an old instruction to start an agent, remove a handoff or run a particular
lane is not a new task. Use the refactor index to reach history only when investigating it.

The [Photoshop layered TIFF spike](photoshop-layered-tiff-spike.md) records the original
format investigation and older production path. Current isolated import/save evidence is
reached through the refactor index; the spike is not full PSD compatibility acceptance.

# TODO

## P0

- Verify multi-select group dragging in the Electron app with a real mouse/trackpad. Automated checks covered shared reorder logic and drag overlay DOM, but dnd-kit final drop behavior still needs hands-on confirmation.
- Verify double-click dialogue creation/editing/autosave/reopen recovery after the compact dialogue-strip UI changes.
- Verify dialogue editing edge cases: focus, blur, empty cleanup, and dragging immediately after editing.

## P1

- Improve marquee selection so it is usable when the board is dense (current box-selection only starts from empty grid background).
- Add validation or cleanup for missing Recent folder paths.
- Add UI feedback for autosave failures that persists long enough for users to notice.
- Add more focused tests for rename edge cases beyond current preflight coverage, including source names with existing numeric prefixes.
- Add a clearer Save conflict resolution UI beyond the current preflight error message. Current `Save` has no confirmation UI, rollback UI, or detailed recovery flow for unexpected filesystem errors during rename.

## P2

- Consider a dedicated select/hand/draw tool mode if drawing, selecting, and dragging conflict in real use.
- Consider storing sketch canvas dimensions explicitly if zoom or image aspect behavior becomes more complex.
- Review whether `electron/preload/preload.cjs` should continue to be manually maintained or generated from TypeScript.

## Known Simplifications

- Zoom slider changes card density, but sketch strokes are stored against a fixed Konva canvas size. Smoke tested at multiple zoom levels.
- Recent folder entries are stored as paths in app userData and are not validated for existence.

## Out Of Scope For Current MVP

- AI prompt fields or AI export.
- PDF or image sequence export.
- SQLite migration.
- Photoshop integration or file watching.
- Cloud sync or collaboration.
- Advanced drawing tools.

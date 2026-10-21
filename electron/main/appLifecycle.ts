/**
 * Pure policy for the app lifecycle. The window close handler always defers to
 * the recovery close barrier (it calls preventDefault and finishes later), so an
 * explicit Quit must be remembered and re-issued once the last window is gone;
 * otherwise the quit request is swallowed and the process stays alive.
 */
export const shouldQuitAfterLastWindow = (isDarwin: boolean, quitRequested: boolean): boolean =>
  !isDarwin || quitRequested;

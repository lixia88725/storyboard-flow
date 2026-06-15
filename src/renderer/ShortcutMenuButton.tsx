import { defaultKeyboardShortcuts } from "./keyboardShortcuts";
import { GearIcon } from "./icons";
import { shortcutMenuItems, useShortcutMenuController } from "./shortcutMenuController";

export const ShortcutMenuButton = () => {
  const {
    isShortcutMenuOpen,
    setIsShortcutMenuOpen,
    shortcutMenuRef
  } = useShortcutMenuController();

  return (
    <div className="shortcut-menu-container" ref={shortcutMenuRef}>
      <button
        type="button"
        className={isShortcutMenuOpen ? "selected" : ""}
        onClick={() => setIsShortcutMenuOpen((isOpen) => !isOpen)}
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
        aria-expanded={isShortcutMenuOpen}
      >
        <GearIcon />
      </button>
      {isShortcutMenuOpen ? (
        <div className="shortcut-menu" aria-label="Keyboard shortcuts">
          <div className="shortcut-menu-head">
            <strong>Shortcuts</strong>
            <span>Fixed shortcuts for the current build.</span>
          </div>
          <div className="shortcut-list">
            {shortcutMenuItems.map(({ action, label }) => (
              <div key={action} className="shortcut-field">
                <span>{label}</span>
                <kbd className="shortcut-key-display">{defaultKeyboardShortcuts[action]}</kbd>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

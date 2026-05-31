# Onion Skin Opacity Audit

Date: 2026-05-31

## Goal

Decide whether Animation mode should add user-facing Onion Skin opacity controls.

This audit is behavior-preserving. It does not change Onion Skin rendering or UI.

## Current Behavior

- Onion Skin is available only in Animation mode.
- The bottom bar exposes a single `Onion Skin` checkbox.
- Previous and next ghosts are rendered as separate `.onion-skin-ghost` elements.
- Ghost opacity is fixed in CSS at `0.28`.
- Previous ghost uses a red-tinted filter.
- Next ghost uses a green-tinted filter.
- Visible bitmap layer opacity and blend mode are still applied inside each ghost.
- `npm run smoke:bitmap` asserts the fixed ghost opacity is `0.28` and checks previous/next ghost presence across timeline navigation.

## Dogfood Signal

TEST2 mixed-aspect dogfood found Onion Skin functional but visually strong over real drawings.

This is a real signal, but it is not yet enough to justify another visible control. The note was qualitative, not a repeated workflow failure.

## Options Considered

### Option 1: Add an Onion Skin opacity slider

Pros:

- Gives users direct control.
- Helps with dense or high-contrast drawings.

Cons:

- Adds another persistent bottom-bar control.
- Requires deciding persistence semantics: per app, per folder, or session-only.
- Adds keyboard/settings questions if it becomes a first-class preference.
- Makes Animation mode more configurable before there is enough user evidence.

### Option 2: Lower the fixed opacity

Pros:

- No new UI.
- Could immediately reduce visual strength.

Cons:

- May make Onion Skin too subtle on lighter drawings.
- Current smoke and dogfood baseline explicitly verify `0.28`, so changing it should be based on stronger visual evidence.

### Option 3: Keep current control and watch for repeated feedback

Pros:

- Keeps Animation mode simple.
- Preserves the current tested baseline.
- Avoids adding preference/state surface before users ask for it.

Cons:

- Users with dense drawings may still find the ghosts strong.

## Recommendation

Do not add Onion Skin opacity controls now.

Keep the current checkbox-only UI and fixed `0.28` opacity. If real users repeatedly find Onion Skin distracting, first consider lowering the fixed opacity slightly or adding a compact intensity control scoped to Animation mode.

## Follow-up Criteria

Revisit this only if dogfood or user sessions show at least one of:

- users turn Onion Skin off because it is visually distracting
- users cannot read the current drawing while Onion Skin is enabled
- the red/green tint is confusing over common storyboard colors
- users ask for per-shot or per-project Onion Skin intensity

Until then, treat opacity controls as deferred.

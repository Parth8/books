// The live app state, shared by every part of the screen. Read the bindings directly (they are
// live: an import always sees the latest value); change them only through the setters, so
// there is one place where the state is replaced.
//
//   state     your shelves, books, XP and settings (see js/store.js for the shape)
//   account   the signed-in account engine, or null
//   syncRef   the sync-code engine, once it exists (the HUD draws before it does)

export let state = null;
export let account = null;
export let syncRef = null;

/** Replace the state. Returns the new state, so it can be used in an expression. */
export function setState(next) {
  state = next;
  return next;
}
export function setAccount(a) {
  account = a;
  return a;
}
export function setSyncRef(s) {
  syncRef = s;
  return s;
}

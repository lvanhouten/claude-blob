// Falls back to no-ops so the page can be previewed in a plain browser.
export const api = window.blob ?? {
  onEvent() {}, onCursor() {}, onLight() {}, onColor() {}, onPin() {}, setSessions() {}, setIgnore() {}, dragStart() {}, dragEnd() {}, contextMenu() {},
};

// Gallery mode: ?state=<name> holds one animation on a loop, ?embed hides the
// bubble and status chip and uses a lighter mesh so many can run at once.
export const params = new URLSearchParams(location.search);
export const LOCKED = params.get('state');
export const EMBED = params.has('embed');
if (EMBED) document.body.classList.add('embed');

export function registerDetachedJournalLayout() {
  const journal = foundry.applications.sheets.journal.JournalEntrySheet.prototype;
  const prePosition = journal._prePosition;

  journal._prePosition = function(position) {
    prePosition.call(this, position);
    const element = this.element;
    if (this.window.windowId !== this.id || !element?.classList.contains("collapsing")) return;

    // Keep the standalone frame fitted to its popup while the index changes width.
    position.left = 0;
    position.width = element.ownerDocument.documentElement.clientWidth / (position.scale ?? 1);
  };
}

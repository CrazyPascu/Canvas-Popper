import { registerSidebarCreationDialogs } from "./creation-dialogs.js";
import { supportDetachedChat } from "./detached-chat.js";
import { registerDetachedJournalLayout } from "./journal-popouts.js";
import { registerNamedLayouts } from "./named-layouts.js";
import { registerPopoutWorkspace } from "./popout-workspace.js";
import { registerDnd5eRollDialogs, registerSidebarDialogPlacement } from "./sidebar-dialogs.js";
import { registerToolbarWindows, scrollWheelHorizontally } from "./toolbar-windows.js";
import { installDockSplitter, setSplitterLocked } from "./workspace-dock-splitter.js";

const MODULE_ID = "canvas-popper";
const TOUCH_MODE_SETTING = "touchMode";
const SIDEBAR_PINS_SETTING = "sidebarPins";
const LOCK_LAYOUT_SETTING = "lockLayout";
const COMPACT_CHAT_SETTING = "showCompactChat";
const CREATION_DIALOG_SETTING = "creationDialogPlacement";
const DND5E_ROLL_DIALOG_SETTING = "showDnd5eRollDialogsInSidebar";
const DETACH_LABEL = "Open sidebar in a separate window";
const RETURN_LABEL = "Return sidebar to Foundry";
const DETACH_ICON = "fa-arrow-up-right-from-square";
const NOTE_DRAG_TYPE = "application/x-sidebar-window-note";

let detachedSidebar;
let opening = false;
let savedSidebarPins;
let pinSaveQueue = Promise.resolve();

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SIDEBAR_PINS_SETTING, {
    scope: "user",
    config: false,
    type: Array,
    default: []
  });
  game.settings.register(MODULE_ID, LOCK_LAYOUT_SETTING, {
    name: "Lock layout",
    hint: "Lock widget and sidebar column positions and sizes in Canvas Popper windows.",
    scope: "user",
    config: true,
    type: Boolean,
    default: false,
    onChange(locked) {
      popouts.setLocked(locked);
      detachedSidebar?.pinning.setLocked(locked);
      detachedSidebar?.layoutActions.refresh();
    }
  });
  game.settings.register(MODULE_ID, TOUCH_MODE_SETTING, {
    name: "Touch mode",
    hint: "Make buttons and other interactive controls larger in Canvas Popper windows.",
    scope: "user",
    config: true,
    type: Boolean,
    default: false,
    onChange(enabled) {
      for (const [id, { window: popup }] of foundry.applications.detached.windows) {
        if (id.startsWith("sidebar-window-") && !popup.closed) applyTouchMode(popup, enabled);
      }
    }
  });
  game.settings.register(MODULE_ID, COMPACT_CHAT_SETTING, {
    name: "Show compact chat",
    hint: "Show compact chat in the main window when the sidebar is detached and its Chat tab is out of view.",
    scope: "user",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => detachedSidebar?.chat.setShowCompactChat(game.settings.get(MODULE_ID, COMPACT_CHAT_SETTING))
  });
  game.settings.register(MODULE_ID, CREATION_DIALOG_SETTING, {
    name: "Creation dialog placement",
    hint: "Choose where creation dialogs open when launched from the detached sidebar.",
    scope: "user",
    config: true,
    type: String,
    choices: {
      normal: "Normal popups",
      sidebar: "Window-constrained popups"
    },
    default: "sidebar"
  });
  const isDnd5e = game.system.id === "dnd5e";
  game.settings.register(MODULE_ID, DND5E_ROLL_DIALOG_SETTING, {
    name: "D&D 5e roll dialogs in sidebar",
    hint: "Open roll configuration in the detached sidebar when a D&D 5e roll starts there.",
    scope: "user",
    config: isDnd5e,
    type: Boolean,
    default: false
  });
  if (isDnd5e) registerDnd5eRollDialogs(() => getSidebarDialogPopup("roll"));
});

Hooks.once("ready", async () => {
  const userSettings = game.settings.storage.get("user");
  const user = game.userId;
  for (const { id, key, namespace, scope, type } of game.settings.settings.values()) {
    if (namespace !== MODULE_ID || scope !== "user" || type !== Boolean) continue;
    if (userSettings.getSetting(id, user)) continue;
    const previous = userSettings.getSetting(`sidebar-window.${key}`, user);
    if (typeof previous?.value !== "boolean") continue;
    try {
      await game.settings.set(MODULE_ID, key, previous.value);
    } catch (error) {
      console.error(`Canvas Popper | Could not migrate the ${key} setting`, error);
    }
  }
});

Hooks.on("renderSidebar", (sidebar, element) => {
  const menu = element.querySelector("#sidebar-tabs > menu");
  if (!menu || menu.querySelector(".sidebar-window-toggle")) return;

  const item = document.createElement("li");
  const button = createButton(DETACH_LABEL, DETACH_ICON);
  button.classList.add("sidebar-window-toggle");
  button.addEventListener("click", () => {
    if (detachedSidebar) popouts.dock("sidebar");
    else void openSidebar(sidebar);
  });
  item.append(button);
  menu.append(item);
});

// A tab that becomes available after detaching still renders into its Foundry template.
Hooks.on("renderApplicationV2", (app, element, _context, options) => {
  if (!detachedSidebar || !app.tabName || app !== ui[app.tabName]) return;
  if (options.isFirstRender) {
    const placeholder = ui.sidebar.element.querySelector(`#sidebar-content > template[id="${CSS.escape(app.id)}"]`);
    placeholder?.replaceWith(element);
  }
  if (detachedSidebar.pinning.hasPins) {
    detachedSidebar.pinning.refresh();
    detachedSidebar.chat.refresh();
  }
});

Hooks.on("changeSidebarTab", () => {
  if (!detachedSidebar) return;
  detachedSidebar.pinning.refresh();
  detachedSidebar.chat.refresh();
});

Hooks.on("openDetachedWindow", (id, popup) => {
  if (id.startsWith("sidebar-window-")) applyTouchMode(popup, game.settings.get(MODULE_ID, TOUCH_MODE_SETTING));
});

function applyTouchMode(popup, enabled) {
  popup.document.documentElement.classList.toggle("canvas-popper-touch-mode", enabled);
}

function createButton(label, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ui-control plain icon fa-solid ${icon}`;
  labelButton(button, label);
  return button;
}

function labelButton(button, label) {
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
}

function isLayoutLocked() {
  return game.settings.get(MODULE_ID, LOCK_LAYOUT_SETTING);
}

const popouts = registerPopoutWorkspace(MODULE_ID, isLayoutLocked);
const attachLayoutActions = registerNamedLayouts(MODULE_ID, {
  createButton,
  snapshotLayout: () => ({ docks: popouts.snapshotLayout(), pins: structuredClone(getSidebarPins()) }),
  applyLayout(layout) {
    const pins = structuredClone(layout.pins);
    detachedSidebar.pinning.applyPins(pins);
    saveSidebarPins(pins);
    popouts.applyLayout(layout.docks);
    detachedSidebar.chat.refresh();
  },
  isLayoutLocked,
  toggleLayoutLock: () => game.settings.set(MODULE_ID, LOCK_LAYOUT_SETTING, !isLayoutLocked())
});
registerToolbarWindows(MODULE_ID, { createButton, labelButton }, popouts, () => openSidebar(ui.sidebar));
registerSidebarDialogPlacement(getSidebarDialogPopup);
registerDetachedJournalLayout();
registerSidebarCreationDialogs(() => getSidebarDialogPopup("creation"));

function getSidebarDialogPopup(kind) {
  if (!detachedSidebar) return;
  if (kind === "layout") return detachedSidebar.popup;
  if (kind === "creation" && game.settings.get(MODULE_ID, CREATION_DIALOG_SETTING) === "sidebar") return detachedSidebar.popup;
  if (kind === "roll" && game.system.id === "dnd5e" && game.settings.get(MODULE_ID, DND5E_ROLL_DIALOG_SETTING)) {
    return detachedSidebar.popup;
  }
}

async function openSidebar(sidebar) {
  if (opening || detachedSidebar) return;
  const toggle = sidebar?.element?.querySelector(".sidebar-window-toggle");
  if (!toggle) return;
  opening = true;
  toggle.disabled = true;

  try {
    const { element, expanded } = sidebar;
    const { right, top } = element.getBoundingClientRect();
    const width = 560;
    const position = {
      left: window.screenX + right - width,
      top: window.screenY + top,
      width,
      height: Math.min(840, window.screen.availHeight - 80)
    };
    await popouts.open("sidebar", "Sidebar Window", position, popup => {
      if (sidebar.element !== element || !element.isConnected) return;

      // Foundry uses this element's width to position off-screen indicators in the main canvas.
      const canvasInset = document.createElement("span");
      canvasInset.id = "sidebar-content";
      canvasInset.hidden = true;

      const tabs = toggle.closest("nav");
      const tooltipDirection = tabs.dataset.tooltipDirection;
      const pinning = createSidebarPinning(sidebar, tabs, popup);
      const layoutActions = attachLayoutActions(toggle.closest("menu"), popup);
      const chat = supportDetachedChat(popup, {
        showCompactChat: game.settings.get(MODULE_ID, COMPACT_CHAT_SETTING),
        isChatVisible: () => pinning.isTabVisible("chat")
      });
      function restore() {
        detachedSidebar = undefined;
        pinning.dispose();
        layoutActions.dispose();
        canvasInset.replaceWith(element);
        element.classList.remove("sidebar-window-detached");
        element.removeEventListener("dragstart", markNoteDrag, true);
        chat.restore(() => sidebar.toggleExpanded(expanded));
        tabs.dataset.tooltipDirection = tooltipDirection;
        toggle.classList.replace("fa-arrow-right-to-bracket", DETACH_ICON);
        labelButton(toggle, DETACH_LABEL);
      }

      detachedSidebar = { popup, pinning, chat, layoutActions };
      element.before(canvasInset);
      sidebar.expand();
      element.classList.add("sidebar-window-detached");
      element.addEventListener("dragstart", markNoteDrag, true);
      tabs.dataset.tooltipDirection = "DOWN";
      toggle.classList.replace(DETACH_ICON, "fa-arrow-right-to-bracket");
      labelButton(toggle, RETURN_LABEL);
      return { element, restore };
    });
    detachedSidebar?.pinning.refresh();
    detachedSidebar?.chat.refresh();
  } catch (error) {
    console.error("Sidebar Window | Could not open the sidebar window", error);
  } finally {
    opening = false;
    toggle.disabled = false;
  }
}

function getSidebarPins() {
  return savedSidebarPins ??= game.settings.get(MODULE_ID, SIDEBAR_PINS_SETTING);
}

function saveSidebarPins(pins) {
  savedSidebarPins = pins;
  pinSaveQueue = pinSaveQueue.then(() => game.settings.set(MODULE_ID, SIDEBAR_PINS_SETTING, pins)).catch(error => {
    console.error("Canvas Popper | Could not save sidebar pins", error);
  });
}

function createSidebarPinning(sidebar, tabs, popup) {
  const { element } = sidebar;
  const menu = tabs.querySelector(":scope > menu");
  const content = element.querySelector("#sidebar-content");
  let columns = new Map();
  const minimumPinnedWidth = 140;
  const minimumMainWidth = 200;
  const pin = createButton("Pin selected tab", "fa-thumbtack");
  pin.classList.add("sidebar-window-pin");
  tabs.append(pin);
  let locked = isLayoutLocked();

  const empty = document.createElement("p");
  empty.className = "sidebar-window-empty";
  empty.textContent = "All tabs are pinned.";
  empty.hidden = true;
  content.append(empty);

  let browsingTab = sidebar.tabGroups.primary;
  let previousTab;
  let cancelInteraction;
  let draggedTab;

  function getAvailableTabButtons() {
    return [...menu.querySelectorAll("li:not([hidden]) > button[data-group=primary]")];
  }

  function getUnpinnedTabs() {
    return getAvailableTabButtons().map(button => button.dataset.tab).filter(tab => !columns.has(tab));
  }

  function savePins() {
    const available = new Set(getAvailableTabButtons().map(button => button.dataset.tab));
    const pins = Array.from(columns, ([tab, { width }]) => ({ tab, width }));
    // Preserve preferences for tabs that are currently unavailable.
    for (const pin of getSidebarPins()) {
      if (pin && typeof pin.tab === "string" && !available.has(pin.tab) && !columns.has(pin.tab)) pins.push(pin);
    }
    saveSidebarPins(pins);
  }

  function getColumnGap() {
    return parseFloat(popup.getComputedStyle(element).columnGap) || 0;
  }

  function maximumWidth(column, next) {
    if (next) return column.width + next.width - minimumPinnedWidth;
    const available = element.clientWidth - minimumMainWidth - columns.size * getColumnGap();
    return Math.max(column.width, minimumPinnedWidth * 2, available);
  }

  function setInteraction(cancel) {
    if (cancel && (locked || cancelInteraction)) return false;
    cancelInteraction = cancel;
    return true;
  }

  function getColumnResize(column) {
    if (locked || cancelInteraction) return;
    const ordered = [...columns.values()];
    const next = ordered[ordered.indexOf(column) + 1];
    const originalWidth = column.width;
    const nextWidth = next?.width;
    function apply(width) {
      column.width = width;
      if (next) next.width = nextWidth + originalWidth - width;
      updateWidths();
    }
    return {
      axis: "x", value: originalWidth, direction: 1,
      min: minimumPinnedWidth, max: maximumWidth(column, next),
      apply,
      commit: savePins,
      restore: () => apply(originalWidth)
    };
  }

  function updateWidths() {
    const ordered = [...columns.values()];
    const tracks = ordered.map(column => `${column.width}px`);
    tracks.push(`minmax(${minimumMainWidth}px, 1fr)`);
    element.style.setProperty("--sidebar-window-columns", tracks.join(" "));
    ordered.forEach((column, index) => {
      column.divider.setAttribute("aria-valuenow", String(column.width));
      column.divider.setAttribute("aria-valuetext", `${column.width} pixels`);
      column.divider.setAttribute("aria-valuemax", String(maximumWidth(column, ordered[index + 1])));
    });
  }

  function refresh() {
    const selectedTab = sidebar.tabGroups.primary;
    const available = getUnpinnedTabs();
    const nextBrowsingTab = [selectedTab, browsingTab].find(tab => available.includes(tab)) ?? available[0];
    if (nextBrowsingTab !== browsingTab) {
      previousTab = browsingTab;
      browsingTab = nextBrowsingTab;
    }

    element.classList.toggle("sidebar-window-split", Boolean(columns.size));
    element.style.setProperty("--sidebar-window-main-column", String(columns.size + 1));
    empty.hidden = !columns.size || Boolean(browsingTab);
    pin.disabled = locked || !browsingTab;
    let index = 0;
    for (const [tab, column] of columns) {
      column.index = String(++index);
      for (const part of [column.header, column.divider]) {
        part.style.setProperty("--sidebar-window-column", column.index);
        part.classList.toggle("sidebar-window-column-dragging", tab === draggedTab);
      }
    }
    for (const panel of content.querySelectorAll(":scope > .tab[data-group='primary']")) {
      const column = columns.get(panel.dataset.tab);
      panel.classList.toggle("sidebar-window-pinned", Boolean(column));
      panel.classList.toggle("sidebar-window-column-dragging", panel.dataset.tab === draggedTab);
      if (column) panel.style.setProperty("--sidebar-window-column", column.index);
      else panel.style.removeProperty("--sidebar-window-column");
      // Foundry uses the active class for both panel visibility and tab-specific layout.
      panel.classList.toggle("active", Boolean(column) || panel.dataset.tab === browsingTab);
    }
    for (const tab of tabs.querySelectorAll("button[data-group='primary']")) {
      tab.classList.toggle("sidebar-window-pinned-tab", columns.has(tab.dataset.tab));
    }
    updateWidths();
  }

  function addColumn(button, width) {
    const tab = button.dataset.tab;
    const title = button.getAttribute("aria-label");
    const header = document.createElement("div");
    header.className = "sidebar-window-pinned-header";
    header.dataset.tooltipDirection = "DOWN";
    const heading = document.createElement("span");
    heading.className = "ellipsis";
    heading.textContent = title;
    const unpin = createButton(`Unpin ${title}`, "fa-thumbtack-slash");
    unpin.classList.add("sidebar-window-unpin");
    header.append(heading, unpin);

    const column = { header, width, unpin };
    const divider = document.createElement("div");
    divider.className = "sidebar-window-divider";
    divider.setAttribute("aria-label", "Resize " + title);
    divider.setAttribute("aria-orientation", "vertical");
    divider.setAttribute("aria-controls", "sidebar-content");
    column.divider = divider;
    columns.set(tab, column);
    element.append(header, column.divider);
    header.addEventListener("pointerdown", event => startColumnReorder(event, tab));
    unpin.addEventListener("click", () => unpinTab(tab));
    installDockSplitter(popup, divider, () => getColumnResize(column), setInteraction);
    return column;
  }

  pin.addEventListener("click", () => {
    if (locked || !browsingTab) return;
    const button = getAvailableTabButtons().find(button => button.dataset.tab === browsingTab);
    if (!button) return;
    cancelInteraction?.();
    const width = Math.max(minimumPinnedWidth, Math.round(tabs.getBoundingClientRect().width / 3));
    const { unpin } = addColumn(button, width);
    const alternatives = getUnpinnedTabs();
    const nextTab = alternatives.includes(previousTab) ? previousTab : alternatives[0];
    if (nextTab) sidebar.changeTab(nextTab, "primary");
    refresh();
    savePins();
    element.scrollLeft = element.scrollWidth;
    (pin.disabled ? unpin : pin).focus({ preventScroll: true });
  });

  function startColumnReorder(event, tab) {
    if (locked || columns.size < 2 || cancelInteraction || !event.isPrimary || event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();

    const { pointerId, clientX: startX, currentTarget: header } = event;
    const originalColumns = columns;
    const neighbors = [...originalColumns];
    const from = neighbors.findIndex(([key]) => key === tab);
    const [entry] = neighbors.splice(from, 1);
    const column = entry[1];
    const gap = getColumnGap();
    const draggedSpan = column.width + gap;
    const slotStarts = [0];
    for (const [, neighbor] of neighbors) slotStarts.push(slotStarts.at(-1) + neighbor.width + gap);
    // Keep the snap thresholds fixed as neighboring columns change positions.
    const centers = neighbors.map(([, neighbor], index) =>
      slotStarts[index] + neighbor.width / 2 + (index >= from ? draggedSpan : 0)
    );

    const viewportLeft = element.getBoundingClientRect().left + element.clientLeft;
    const initialScroll = element.scrollLeft;
    const lastSlot = slotStarts.at(-1);
    const pinnedRight = lastSlot + draggedSpan;
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    let clientX = startX;
    let destination = from;
    let frame = 0;

    function updatePreview() {
      const scroll = element.scrollLeft;
      const pointerX = clientX - viewportLeft + scroll;
      const next = centers.findIndex(center => pointerX < center);
      const target = next === -1 ? neighbors.length : next;
      const left = Math.max(0, Math.min(lastSlot, slotStarts[from] + clientX - startX + scroll - initialScroll));
      element.style.setProperty("--sidebar-window-drag-offset", `${left - slotStarts[target]}px`);

      if (target !== destination) {
        destination = target;
        const order = neighbors.slice();
        order.splice(destination, 0, entry);
        columns = new Map(order);
        refresh();
      }
    }

    function scrollAtEdge() {
      frame = 0;
      const x = clientX - viewportLeft;
      const right = element.clientWidth - x;
      const previous = element.scrollLeft;
      const maxScroll = pinnedRight - element.clientWidth;
      const edge = 32;
      const maxStep = 16;
      if (x < edge) element.scrollLeft -= Math.min(edge - x, maxStep);
      else if (right < edge && previous < maxScroll) {
        element.scrollLeft = Math.min(maxScroll, previous + Math.min(edge - right, maxStep));
      }
      if (element.scrollLeft === previous) return;
      updatePreview();
      frame = popup.requestAnimationFrame(scrollAtEdge);
    }

    function move(pointer) {
      if (pointer.pointerId !== pointerId) return;
      clientX = pointer.clientX;
      if (!draggedTab) {
        if (Math.abs(clientX - startX) < 4) return;
        draggedTab = tab;
        refresh();
      }
      updatePreview();
      if (!frame) frame = popup.requestAnimationFrame(scrollAtEdge);
    }

    function finish() {
      cancelInteraction = undefined;
      listeners.abort();
      if (frame) popup.cancelAnimationFrame(frame);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      if (!draggedTab) return;
      draggedTab = undefined;
      element.style.removeProperty("--sidebar-window-drag-offset");
      refresh();
    }

    function cancel() {
      columns = originalColumns;
      finish();
    }

    function drop(pointer) {
      if (pointer.pointerId !== pointerId) return;
      if (draggedTab) {
        clientX = pointer.clientX;
        updatePreview();
      }
      finish();
      if (destination === from) return;

      // Keep the capture target in the DOM until release, then match tab order to the grid.
      const nextHeader = neighbors[destination]?.[1].header;
      if (nextHeader) nextHeader.before(header, column.divider);
      else element.append(header, column.divider);
      savePins();
    }

    function cancelPointer(pointer) {
      if (pointer.pointerId === pointerId) cancel();
    }

    element.setPointerCapture(pointerId);
    cancelInteraction = cancel;
    element.addEventListener("pointermove", move, options);
    element.addEventListener("pointerup", drop, options);
    element.addEventListener("pointercancel", cancelPointer, options);
    element.addEventListener("lostpointercapture", cancelPointer, options);
    popup.addEventListener("blur", cancel, options);
    popup.addEventListener("resize", cancel, options);
  }

  function removeColumn(tab) {
    cancelInteraction?.();
    const { header, divider } = columns.get(tab);
    header.remove();
    divider.remove();
    columns.delete(tab);
  }

  function unpinTab(tab) {
    if (locked) return;
    removeColumn(tab);
    sidebar.changeTab(browsingTab ?? tab, "primary");
    refresh();
    if (tab === "chat") detachedSidebar?.chat.refresh();
    savePins();
    pin.focus();
  }

  function setLocked(value) {
    if (value) cancelInteraction?.();
    locked = value;
    element.classList.toggle("sidebar-window-layout-locked", value);
    pin.disabled = value || !browsingTab;
    for (const { unpin, divider } of columns.values()) {
      unpin.disabled = value;
      setSplitterLocked(divider, value);
    }
  }

  function applyPins(pins) {
    for (const tab of columns.keys()) removeColumn(tab);
    const available = new Map(getAvailableTabButtons().map(button => [button.dataset.tab, button]));
    for (const pin of pins) {
      if (!pin || !Number.isFinite(pin.width) || columns.has(pin.tab)) continue;
      const button = available.get(pin.tab);
      if (button) addColumn(button, Math.max(minimumPinnedWidth, Math.round(pin.width)));
    }
    refresh();
    if (columns.has(sidebar.tabGroups.primary) && browsingTab) sidebar.changeTab(browsingTab, "primary");
    setLocked(locked);
  }

  applyPins(getSidebarPins());

  menu.addEventListener("wheel", scrollWheelHorizontally, { passive: false });
  const resizeObserver = new ResizeObserver(updateWidths);
  resizeObserver.observe(element);
  return {
    get hasPins() { return Boolean(columns.size); },
    isTabVisible(tab) {
      const selected = sidebar.tabGroups.primary;
      return columns.has(tab) || (columns.has(selected) ? browsingTab : selected) === tab;
    },
    refresh,
    setLocked,
    applyPins,
    dispose() {
      menu.removeEventListener("wheel", scrollWheelHorizontally);
      resizeObserver.disconnect();
      for (const tab of columns.keys()) removeColumn(tab);
      if (browsingTab) sidebar.changeTab(browsingTab, "primary");
      refresh();
      pin.remove();
      empty.remove();
      element.classList.remove("sidebar-window-layout-locked");
      element.style.removeProperty("--sidebar-window-columns");
      element.style.removeProperty("--sidebar-window-main-column");
    }
  };
}

function markNoteDrag(event) {
  if (event.target.closest(".placeable-entry.note")) event.dataTransfer?.setData(NOTE_DRAG_TYPE, "1");
}

Hooks.on("dropCanvasData", (canvas, data, event) => {
  // Journal entries use Foundry's built-in map note creation. Existing Notes are a separate document type.
  if (data.type !== "Note" || !detachedSidebar || !event.dataTransfer?.getData(NOTE_DRAG_TYPE)) return;
  void copyMapNote(canvas, data, event.shiftKey).catch(error => {
    ui.notifications.error("Could not copy the map note.");
    console.error("Sidebar Window | Could not copy the map note", error);
  });
});

async function copyMapNote(canvas, data, skipSnap) {
  const scene = canvas.scene;
  const Note = foundry.utils.getDocumentClass("Note");
  if (!scene || !Note.canUserCreate(game.user)) return;
  const note = await Note.fromDropData(data);
  if (canvas.scene !== scene || note?.parent !== scene || !note.visible) return;
  const point = { x: data.x, y: data.y };
  const { x, y } = skipSnap ? point : canvas.notes.getSnappedPoint(point);
  if (!canvas.dimensions.rect.contains(x, y)) return;
  await note.clone({ x: Math.round(x), y: Math.round(y) }, { save: true });
}

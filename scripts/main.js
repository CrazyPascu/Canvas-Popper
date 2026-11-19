import { registerSidebarCreationDialogs } from "./creation-dialogs.js";
import { supportDetachedChat } from "./detached-chat.js";
import { keepSidebarWindowOpen, registerDnd5eRollDialogs, registerSidebarDialogPlacement } from "./sidebar-dialogs.js";
import { registerToolbarWindows } from "./toolbar-windows.js";

const MODULE_ID = "canvas-popper";
const TOUCH_MODE_SETTING = "touchMode";
const COMPACT_CHAT_SETTING = "showCompactChat";
const CREATION_DIALOG_SETTING = "creationDialogPlacement";
const DND5E_ROLL_DIALOG_SETTING = "showDnd5eRollDialogsInSidebar";
const DETACH_LABEL = "Open sidebar in a separate window";
const RETURN_LABEL = "Return sidebar to Foundry";
const DETACH_ICON = "fa-arrow-up-right-from-square";
const NOTE_DRAG_TYPE = "application/x-sidebar-window-note";

let detachedSidebar;
let opening = false;

Hooks.once("init", () => {
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
    if (detachedSidebar) {
      const { popup, restore } = detachedSidebar;
      restore();
      popup.close();
    } else {
      void openSidebar(sidebar, button);
    }
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

Hooks.on("closeDetachedWindow", (_id, popup) => {
  if (detachedSidebar?.popup === popup) detachedSidebar.restore();
});

window.addEventListener("pagehide", () => detachedSidebar?.popup.close());

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

registerToolbarWindows(MODULE_ID, { createButton, labelButton });
registerSidebarDialogPlacement(getSidebarDialogPopup);
registerSidebarCreationDialogs(() => getSidebarDialogPopup("creation"));

function getSidebarDialogPopup(kind) {
  if (!detachedSidebar) return;
  if (kind === "creation" && game.settings.get(MODULE_ID, CREATION_DIALOG_SETTING) === "sidebar") return detachedSidebar.popup;
  if (kind === "roll" && game.system.id === "dnd5e" && game.settings.get(MODULE_ID, DND5E_ROLL_DIALOG_SETTING)) {
    return detachedSidebar.popup;
  }
}

async function openSidebar(sidebar, toggle) {
  if (opening || detachedSidebar) return;
  opening = true;
  toggle.disabled = true;

  let popup;
  try {
    const { element, expanded } = sidebar;
    const { right, top } = element.getBoundingClientRect();
    const width = 560;
    popup = await foundry.applications.detached.openWindow({
      id: `sidebar-window-${foundry.utils.randomID()}`,
      position: {
        left: window.screenX + right - width,
        top: window.screenY + top,
        width,
        height: Math.min(840, window.screen.availHeight - 80)
      }
    });
    popup.document.title = "Sidebar Window";
    await keepSidebarWindowOpen(popup);
    if (popup.closed) return;

    // Foundry uses this element's width to position off-screen indicators in the main canvas.
    const canvasInset = document.createElement("span");
    canvasInset.id = "sidebar-content";
    canvasInset.hidden = true;

    const tabs = toggle.closest("nav");
    const tooltipDirection = tabs.dataset.tooltipDirection;
    const pinning = createSidebarPinning(sidebar, tabs, popup);
    const chat = supportDetachedChat(popup, {
      showCompactChat: game.settings.get(MODULE_ID, COMPACT_CHAT_SETTING),
      isChatVisible: () => pinning.isTabVisible("chat")
    });
    function restore() {
      if (detachedSidebar?.popup !== popup) return;
      detachedSidebar = undefined;
      popup.removeEventListener("pagehide", restore);
      pinning.dispose();
      canvasInset.replaceWith(element);
      element.classList.remove("sidebar-window-detached");
      element.removeEventListener("dragstart", markNoteDrag, true);
      chat.restore(() => sidebar.toggleExpanded(expanded));
      tabs.dataset.tooltipDirection = tooltipDirection;
      toggle.classList.replace("fa-arrow-right-to-bracket", DETACH_ICON);
      labelButton(toggle, DETACH_LABEL);
    }

    detachedSidebar = { popup, restore, pinning, chat };
    popup.addEventListener("pagehide", restore, { once: true });
    element.before(canvasInset);
    sidebar.expand();
    element.classList.add("sidebar-window-detached");
    element.addEventListener("dragstart", markNoteDrag, true);
    popup.document.body.append(element);
    tabs.dataset.tooltipDirection = "DOWN";
    toggle.classList.replace(DETACH_ICON, "fa-arrow-right-to-bracket");
    labelButton(toggle, RETURN_LABEL);
    popup.focus();
  } catch (error) {
    detachedSidebar?.restore();
    popup?.close();
    console.error("Sidebar Window | Could not open the sidebar window", error);
  } finally {
    opening = false;
    toggle.disabled = false;
  }
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

  const empty = document.createElement("p");
  empty.className = "sidebar-window-empty";
  empty.textContent = "All tabs are pinned.";
  empty.hidden = true;
  content.append(empty);

  let browsingTab = sidebar.tabGroups.primary;
  let previousTab;
  let cancelReorder;
  let draggedTab;

  function getUnpinnedTabs() {
    return Array.from(tabs.querySelectorAll("li:not([hidden]) > button[data-group='primary']"))
      .map(button => button.dataset.tab)
      .filter(tab => !columns.has(tab));
  }

  function getColumnGap() {
    return parseFloat(popup.getComputedStyle(element).columnGap) || 0;
  }

  function maximumWidth(column, next) {
    if (next) return column.width + next.width - minimumPinnedWidth;
    const available = element.clientWidth - minimumMainWidth - columns.size * getColumnGap();
    return Math.max(column.width, minimumPinnedWidth * 2, available);
  }

  function resizeColumn(column, width) {
    cancelReorder?.();
    const ordered = [...columns.values()];
    const next = ordered[ordered.indexOf(column) + 1];
    const clamped = Math.max(minimumPinnedWidth, Math.min(maximumWidth(column, next), width));
    if (next) next.width += column.width - clamped;
    column.width = clamped;
    updateWidths();
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
    pin.disabled = !browsingTab;
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

  pin.addEventListener("click", () => {
    if (!browsingTab) return;
    cancelReorder?.();
    const tab = browsingTab;
    const button = tabs.querySelector(`button[data-tab="${CSS.escape(tab)}"]`);
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

    const width = Math.max(minimumPinnedWidth, Math.round(tabs.getBoundingClientRect().width / 3));
    const column = { header, width };
    column.divider = createPaneDivider(column, title, minimumPinnedWidth, resizeColumn);
    columns.set(tab, column);
    element.append(header, column.divider);
    header.addEventListener("pointerdown", event => startColumnReorder(event, tab));
    unpin.addEventListener("click", () => unpinTab(tab));

    const alternatives = getUnpinnedTabs();
    const nextTab = alternatives.includes(previousTab) ? previousTab : alternatives[0];
    if (nextTab) sidebar.changeTab(nextTab, "primary");
    refresh();
    element.scrollLeft = element.scrollWidth;
    (pin.disabled ? unpin : pin).focus({ preventScroll: true });
  });

  function startColumnReorder(event, tab) {
    if (columns.size < 2 || cancelReorder || !event.isPrimary || event.button !== 0 || event.target.closest("button")) return;
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
      cancelReorder = undefined;
      listeners.abort();
      if (frame) popup.cancelAnimationFrame(frame);
      if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId);
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
    }

    function cancelPointer(pointer) {
      if (pointer.pointerId === pointerId) cancel();
    }

    header.setPointerCapture(pointerId);
    cancelReorder = cancel;
    header.addEventListener("pointermove", move, options);
    header.addEventListener("pointerup", drop, options);
    header.addEventListener("pointercancel", cancelPointer, options);
    header.addEventListener("lostpointercapture", cancelPointer, options);
    popup.addEventListener("blur", cancel, options);
    popup.addEventListener("resize", cancel, options);
  }

  function removeColumn(tab) {
    cancelReorder?.();
    const { header, divider } = columns.get(tab);
    header.remove();
    divider.remove();
    columns.delete(tab);
  }

  function unpinTab(tab) {
    removeColumn(tab);
    sidebar.changeTab(browsingTab ?? tab, "primary");
    refresh();
    if (tab === "chat") detachedSidebar?.chat.refresh();
    pin.focus();
  }

  function scrollTabs(event) {
    const { deltaMode, deltaX, deltaY, ctrlKey } = event;
    if (ctrlKey || deltaX || !deltaY || menu.scrollWidth <= menu.clientWidth) return;

    let pixelsPerUnit = 1;
    if (deltaMode === WheelEvent.DOM_DELTA_LINE) pixelsPerUnit = parseFloat(getComputedStyle(menu).fontSize);
    else if (deltaMode === WheelEvent.DOM_DELTA_PAGE) pixelsPerUnit = menu.clientWidth;

    const previousOffset = menu.scrollLeft;
    menu.scrollLeft += deltaY * pixelsPerUnit;
    if (menu.scrollLeft !== previousOffset) event.preventDefault();
  }

  menu.addEventListener("wheel", scrollTabs, { passive: false });
  popup.addEventListener("resize", updateWidths);
  return {
    get hasPins() { return Boolean(columns.size); },
    isTabVisible(tab) {
      const selected = sidebar.tabGroups.primary;
      return columns.has(tab) || (columns.has(selected) ? browsingTab : selected) === tab;
    },
    refresh,
    dispose() {
      menu.removeEventListener("wheel", scrollTabs);
      popup.removeEventListener("resize", updateWidths);
      for (const tab of columns.keys()) removeColumn(tab);
      if (browsingTab) sidebar.changeTab(browsingTab, "primary");
      refresh();
      pin.remove();
      empty.remove();
      element.style.removeProperty("--sidebar-window-columns");
      element.style.removeProperty("--sidebar-window-main-column");
    }
  };
}

function createPaneDivider(column, title, minimum, resizeColumn) {
  const divider = document.createElement("div");
  divider.className = "sidebar-window-divider";
  divider.tabIndex = 0;
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-label", `Resize ${title}`);
  divider.setAttribute("aria-orientation", "vertical");
  divider.setAttribute("aria-controls", "sidebar-content");
  divider.setAttribute("aria-valuemin", String(minimum));

  let grabOffset;
  divider.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    divider.focus();
    grabOffset = event.clientX - column.header.getBoundingClientRect().right;
    divider.setPointerCapture(event.pointerId);
  });
  divider.addEventListener("pointermove", event => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    const left = column.header.getBoundingClientRect().left;
    resizeColumn(column, Math.round(event.clientX - left - grabOffset));
  });
  divider.addEventListener("keydown", event => {
    const widths = {
      ArrowLeft: column.width - 12,
      ArrowRight: column.width + 12,
      Home: minimum,
      End: Infinity
    };
    if (!Object.hasOwn(widths, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    resizeColumn(column, widths[event.key]);
  });
  return divider;
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

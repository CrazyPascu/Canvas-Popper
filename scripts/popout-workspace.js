import { createWorkspaceDocks, workspacePositions } from "./workspace-docks.js";
import { keepSidebarWindowOpen } from "./sidebar-dialogs.js";

export function registerPopoutWorkspace(moduleId) {
  const setting = "combinedPopoutWidgets";
  const legacySetting = "combinePopouts";
  const choices = {
    sidebar: "Sidebar",
    controls: "Scene Controls",
    hotbar: "Hotbar",
    players: "Players"
  };
  const dockSetting = "popoutDockLayout";
  const defaults = { sidebar: "center", controls: "left", hotbar: "bottom", players: "left" };
  const windows = new Map();
  const widgets = new Map();
  let shared;
  let openingShared;
  let dockOrder;
  let saveQueue = Promise.resolve();

  Hooks.once("init", () => {
    game.settings.register(moduleId, legacySetting, {
      scope: "user",
      config: false,
      type: Boolean,
      default: false
    });

    const { SetField, StringField } = foundry.data.fields;
    game.settings.register(moduleId, setting, {
      name: "Combine popouts",
      hint: "Select the widgets that should share a window. Unchecking a widget in the shared window returns it to Foundry.",
      scope: "user",
      config: true,
      type: new SetField(new StringField({ choices }), { initial: [] }),
      input: (field, config) => field.toInput({ ...config, input: undefined, type: "checkboxes" }),
      onChange(selected) {
        for (const widget of widgets.values()) {
          if (widget.host.docks && !selected.has(widget.key)) dock(widget.key);
        }
        combineOpenPopouts(selected);
      }
    });

    game.settings.register(moduleId, dockSetting, {
      scope: "user",
      config: false,
      type: Object,
      default: {}
    });
  });

  Hooks.once("ready", async () => {
    const userSettings = game.settings.storage.get("user");
    if (userSettings.getSetting(`${moduleId}.${setting}`, game.userId)) return;
    if (!game.settings.get(moduleId, legacySetting)) return;
    try {
      await game.settings.set(moduleId, setting, Object.keys(choices));
    } catch (error) {
      console.error("Canvas Popper | Could not migrate the Combine popouts preference", error);
    }
  });

  Hooks.on("closeDetachedWindow", (_id, popup) => {
    const host = windows.get(popup);
    if (host) restoreWindow(host);
  });
  window.addEventListener("pagehide", () => {
    for (const { popup } of windows.values()) popup.close();
  });

  function selectedWidgets() {
    return game.settings.get(moduleId, setting);
  }

  function getDockOrder() {
    if (dockOrder) return dockOrder;
    const saved = game.settings.get(moduleId, dockSetting) ?? {};
    const placed = new Set();
    dockOrder = Object.fromEntries(workspacePositions.map(position => [position, []]));
    for (const position of workspacePositions) {
      if (!Array.isArray(saved[position])) continue;
      for (const key of saved[position]) {
        if (!Object.hasOwn(choices, key) || placed.has(key)) continue;
        dockOrder[position].push(key);
        placed.add(key);
      }
    }

    dockOrder.sizes = {};
    for (const position of workspacePositions) {
      const previous = saved.sizes?.[position];
      if (!previous) continue;
      const sizes = dockOrder.sizes[position] = {};
      for (const key of ["dock", ...Object.keys(choices)]) {
        const preference = previous[key];
        if (Number.isFinite(preference) && preference > 0) sizes[key] = preference;
        else if (key !== "dock" && Number.isFinite(preference?.size) && preference.size > 0) {
          sizes[key] = { size: preference.size };
        }
      }
    }

    // Import positions saved by the previous dropdowns before any widgets are mounted.
    if (!Object.keys(saved).length) {
      const storage = game.settings.storage.get("user");
      for (const key of Object.keys(choices)) {
        const previous = storage.getSetting(moduleId + "." + key + "PopoutPosition", game.userId)?.value;
        if (Object.hasOwn(dockOrder, previous)) dockOrder[previous].push(key);
      }
    }
    return dockOrder;
  }

  function saveDockOrder(order) {
    const snapshot = structuredClone(order);
    saveQueue = saveQueue.then(() => game.settings.set(moduleId, dockSetting, snapshot)).catch(error => {
      console.error("Canvas Popper | Could not save the popout layout", error);
    });
  }

  function workspaceSize() {
    return { width: Math.min(880, window.screen.availWidth), height: Math.min(760, window.screen.availHeight - 80) };
  }

  async function createWindow(key, title, position) {
    const popup = await foundry.applications.detached.openWindow({
      id: `sidebar-window-${key}-${foundry.utils.randomID()}`,
      position
    });
    popup.document.title = title;
    const host = { popup, widgets: new Set(), docks: null };
    windows.set(popup, host);
    popup.addEventListener("pagehide", () => restoreWindow(host), { once: true });
    try {
      await keepSidebarWindowOpen(popup);
      if (popup.closed) throw new Error("The popout closed before the widget could move.");
      if (key === "workspace") prepareWorkspace(host);
      return host;
    } catch (error) {
      popup.close();
      throw error;
    }
  }

  function openWindow(key, title, position) {
    if (!selectedWidgets().has(key)) return createWindow(key, title, position);
    if (shared && !shared.popup.closed) return shared;
    if (!openingShared) {
      openingShared = createWindow("workspace", "Canvas Popper", { ...position, ...workspaceSize() })
        .finally(() => { openingShared = undefined; });
    }
    return openingShared;
  }

  function place(widget, host) {
    const source = widget.host;
    const { element, key } = widget;
    if (host.docks) host.docks.mount(key, choices[key], element);
    else host.popup.document.body.append(element);
    if (source && source !== host) {
      source.docks?.remove(key);
      source.widgets.delete(widget);
      closeIfEmpty(source);
    }
    host.widgets.add(widget);
    widget.host = host;
  }

  function prepareWorkspace(host) {
    if (host.docks) return;
    const { popup } = host;
    host.docks = createWorkspaceDocks(popup, getDockOrder(), defaults, saveDockOrder);
    popup.document.title = "Canvas Popper";

    const { width, height } = workspaceSize();
    if (popup.innerWidth < width || popup.innerHeight < height) {
      popup.resizeBy(Math.max(0, width - popup.innerWidth), Math.max(0, height - popup.innerHeight));
    }
  }

  function combineOpenPopouts(selected) {
    const eligible = [...widgets.values()].filter(widget => selected.has(widget.key) && !widget.host.popup.closed);
    const sidebar = eligible.find(widget => widget.key === "sidebar");
    const existing = eligible.find(widget => widget.host === shared);
    const host = (sidebar ?? existing ?? eligible[0])?.host;
    if (!host) return;

    shared = host;
    prepareWorkspace(host);
    for (const widget of eligible) place(widget, host);
  }

  function closeIfEmpty(host) {
    // Let any widgets awaiting the same newly opened window finish mounting.
    setTimeout(() => {
      if (!host.widgets.size && !host.popup.closed) host.popup.close();
    }, 0);
  }

  function restoreWidget(widget) {
    widgets.delete(widget.key);
    widget.host.widgets.delete(widget);
    try {
      widget.restore();
    } finally {
      widget.host.docks?.remove(widget.key);
    }
  }

  function restoreWindow(host) {
    if (!windows.delete(host.popup)) return;
    if (shared === host) shared = undefined;
    const sidebar = widgets.get("sidebar");
    if (sidebar?.host === host) restoreWidgetSafely(sidebar);
    for (const widget of host.widgets) restoreWidgetSafely(widget);
  }

  function restoreWidgetSafely(widget) {
    try {
      restoreWidget(widget);
    } catch (error) {
      console.error(`Canvas Popper | Could not restore ${widget.key}`, error);
    }
  }

  function dock(key) {
    const widget = widgets.get(key);
    if (!widget) return;
    const { host } = widget;
    restoreWidgetSafely(widget);
    if (key === "sidebar" && host.widgets.size) {
      const apps = foundry.applications.detached.windows.get(host.popup.id)?.applications;
      for (const app of apps?.values() ?? []) {
        if (app.options.canvasPopperSidebarDialog?.windowId === host.popup.id) void app.close();
      }
    }
    closeIfEmpty(host);
  }

  async function open(key, title, position, prepare) {
    const host = await openWindow(key, title, position);
    try {
      const selected = selectedWidgets();
      if (host.popup.closed || (host.docks && !selected.has(key))) return;
      const prepared = prepare(host.popup);
      if (!prepared) return;
      const widget = { key, ...prepared, host };
      widgets.set(key, widget);
      try {
        place(widget, host);
      } catch (error) {
        restoreWidgetSafely(widget);
        throw error;
      }
      if (selected.has(key)) combineOpenPopouts(selected);
      widget.host.popup.focus();
    } finally {
      closeIfEmpty(host);
    }
  }

  return { open, dock };
}

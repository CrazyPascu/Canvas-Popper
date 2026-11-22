const OPEN_ICON = "fa-arrow-up-right-from-square";
const RETURN_ICON = "fa-arrow-right-to-bracket";

export function scrollWheelHorizontally(event, element = event.currentTarget) {
  const { deltaMode, deltaX, deltaY, ctrlKey } = event;
  if (ctrlKey || deltaX || !deltaY || element.scrollWidth <= element.clientWidth) return;

  let pixelsPerUnit = 1;
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
    pixelsPerUnit = parseFloat(element.ownerDocument.defaultView.getComputedStyle(element).fontSize);
  } else if (deltaMode === WheelEvent.DOM_DELTA_PAGE) pixelsPerUnit = element.clientWidth;

  const previousOffset = element.scrollLeft;
  element.scrollLeft += deltaY * pixelsPerUnit;
  if (element.scrollLeft !== previousOffset) event.preventDefault();
}

function inHorizontalDock(element) {
  return element.closest('.canvas-popper-workspace-region:is([data-position="top"], [data-position="bottom"])');
}

function scrollSceneControlRows(event) {
  if (inHorizontalDock(event.currentTarget)) scrollWheelHorizontally(event);
}

function scrollPlayers(event) {
  const element = event.currentTarget;
  if (!inHorizontalDock(element)) return;
  const panel = event.target.closest("#players-active, #players-inactive");
  if (panel) scrollWheelHorizontally(event, panel);
  if (!event.defaultPrevented && element.hasAttribute("data-players-inline")) scrollWheelHorizontally(event);
}

function watchPlayersLayout(element) {
  const stopListening = listenForWheel(element, scrollPlayers);
  const resizeObserver = new ResizeObserver(update);
  const contentObserver = new MutationObserver(observeContent);
  const dockObserver = new MutationObserver(update);
  let observedParent;

  function observeContent() {
    resizeObserver.disconnect();
    resizeObserver.observe(element);
    for (const row of element.querySelectorAll("#players-active .player, #performance-stats")) resizeObserver.observe(row);
    update();
  }

  function update() {
    const region = element.closest(".canvas-popper-workspace-region");
    const parent = region ?? element.parentElement;
    if (observedParent !== parent) {
      dockObserver.disconnect();
      observedParent = parent;
      if (parent) dockObserver.observe(parent, { childList: true });
      if (region) dockObserver.observe(region.parentElement, { attributes: true, attributeFilter: ["data-sized"] });
    }
    if (!inHorizontalDock(element)) {
      element.removeAttribute("data-players-inline");
      return;
    }

    const active = element.querySelector("#players-active");
    const list = active?.querySelector(".players-list");
    const stats = active?.querySelector("#performance-stats");
    if (!list || !stats) return;
    const view = element.ownerDocument.defaultView;
    const style = view.getComputedStyle(element);
    const available = region.parentElement.hasAttribute("data-sized")
      ? element.getBoundingClientRect().height
      : parseFloat(style.maxHeight) || Infinity;

    // Horizontal rows keep the same item heights and row gaps as the stacked panel.
    const rows = [...list.children];
    const gaps = blockSize(view.getComputedStyle(list), "rowGap") * Math.max(0, rows.length - 1);
    const listHeight = rows.reduce((height, row) => height + row.getBoundingClientRect().height +
      blockSize(view.getComputedStyle(row), "marginTop", "marginBottom"), gaps);
    const panelStyle = view.getComputedStyle(active);
    const panelPadding = parseFloat(panelStyle.getPropertyValue("--players-panel-padding")) || 0;
    const frameHeight = blockSize(style, "paddingTop", "paddingBottom") + panelPadding * 2 +
      blockSize(panelStyle, "borderTopWidth", "borderBottomWidth", "rowGap");
    const required = listHeight + stats.getBoundingClientRect().height + frameHeight;
    element.toggleAttribute("data-players-inline", available + 0.5 < required);
  }

  contentObserver.observe(element, { childList: true });
  observeContent();
  return () => {
    stopListening();
    contentObserver.disconnect();
    resizeObserver.disconnect();
    dockObserver.disconnect();
    element.removeAttribute("data-players-inline");
  };
}

function blockSize(style, ...properties) {
  return properties.reduce((size, property) => size + (parseFloat(style[property]) || 0), 0);
}

function listenForWheel(element, listener) {
  element.addEventListener("wheel", listener, { passive: false });
  return () => element.removeEventListener("wheel", listener);
}

export function registerToolbarWindows(moduleId, buttons, popouts, openSidebar) {
  let openingAll = false;
  const openControls = registerToolbarWindow({
    key: "controls",
    hook: "renderSceneControls",
    title: "Scene Controls",
    className: "sidebar-window-scene-controls",
    width: 140,
    height: 460,
    insertButton(element, button) {
      const item = document.createElement("li");
      item.className = "sidebar-window-toolbar-toggle-item";
      item.append(button);
      element.querySelector(":scope > menu").append(item);
    },
    onDetach: element => listenForWheel(element, scrollSceneControlRows),
    onRestore: app => app.setPosition({})
  }, moduleId, buttons, popouts);

  Hooks.once("init", () => {
    const setting = "disableSceneControlTooltips";
    const isSceneControlButton = element => Boolean(element?.closest("#scene-controls button"));
    const tooltipsDisabled = () => game.settings.get(moduleId, setting);
    game.settings.register(moduleId, setting, {
      name: "Disable Scene Controls tooltips",
      hint: "Hide hover tooltips on Scene Controls buttons, both docked and in the popup.",
      scope: "user",
      config: true,
      type: Boolean,
      default: false,
      onChange() {
        if (tooltipsDisabled() && isSceneControlButton(game.tooltip?.element)) game.tooltip.deactivate();
      }
    });

    Hooks.once("setup", () => {
      // Foundry creates the tooltip manager after init. Both hover tips and tool previews use it.
      const { tooltip } = game;
      const activate = tooltip.activate;
      tooltip.activate = function (element, ...args) {
        if (isSceneControlButton(element) && tooltipsDisabled()) {
          if (this.element) this.deactivate();
          return;
        }
        return activate.call(this, element, ...args);
      };
    });
  });

  const openHotbar = registerToolbarWindow({
    key: "hotbar",
    hook: "renderHotbar",
    title: "Hotbar",
    className: "sidebar-window-hotbar",
    width: 600,
    height: 110,
    insertButton: (element, button) => element.append(button),
    syncOpenAllButton,
    onRestore(app) {
      app._onResize();
      // Foundry calculates the docked hotbar offset from the current compact chat layout.
      if (ui.chat?.rendered) ui.chat._toggleNotifications();
    }
  }, moduleId, buttons, popouts);

  const openPlayers = registerToolbarWindow({
    key: "players",
    hook: "renderPlayers",
    title: "Players",
    className: "sidebar-window-players",
    width: 250,
    height: 240,
    insertButton: (element, button) => element.querySelector("#performance-stats").append(button),
    onDetach: watchPlayersLayout
  }, moduleId, buttons, popouts);

  function syncOpenAllButton(element, detached, opening) {
    let button = element.querySelector(".sidebar-window-open-all");
    if (detached) {
      button?.remove();
      return;
    }

    if (!button) {
      button = buttons.createButton("Pop Out All", "fa-window-restore");
      button.classList.add("sidebar-window-open-all");
      button.addEventListener("click", openAll);
      element.insertBefore(button, element.querySelector(".sidebar-window-toolbar-toggle"));
    }
    button.disabled = opening || openingAll;
  }

  async function openAll(event) {
    if (openingAll) return;
    openingAll = true;
    event.currentTarget.disabled = true;
    try {
      // Start each popup from the same user gesture.
      await Promise.all([openSidebar(), openControls(), openPlayers(), openHotbar()]);
    } finally {
      openingAll = false;
      const element = ui.hotbar?.element;
      if (element?.ownerDocument === document) syncOpenAllButton(element, false, false);
    }
  }
}

function registerToolbarWindow(config, moduleId, { createButton, labelButton }, popouts) {
  let detached = false;
  let opening = false;
  const setting = `${config.key}Popout`;
  const openLabel = `Open ${config.title} in a separate window`;
  const returnLabel = `Return ${config.title} to Foundry`;

  function isEnabled() {
    return game.settings.get(moduleId, setting);
  }

  function dock() {
    popouts.dock(config.key);
  }

  function syncButton(app, element) {
    config.syncOpenAllButton?.(element, detached, opening);
    let button = element.querySelector(".sidebar-window-toolbar-toggle");
    if (!isEnabled()) {
      (button?.closest(".sidebar-window-toolbar-toggle-item") ?? button)?.remove();
      return;
    }

    if (!button) {
      button = createButton(openLabel, OPEN_ICON);
      button.classList.add("sidebar-window-toolbar-toggle");
      button.addEventListener("click", () => {
        if (detached) dock();
        else void open(app);
      });
      config.insertButton(element, button);
    }
    button.disabled = opening;
    button.classList.toggle(OPEN_ICON, !detached);
    button.classList.toggle(RETURN_ICON, Boolean(detached));
    labelButton(button, detached ? returnLabel : openLabel);
  }

  async function open(app) {
    if (!app?.rendered || opening || detached || !isEnabled()) return;
    const { element } = app;
    opening = true;
    syncButton(app, element);

    try {
      const { left, top } = element.getBoundingClientRect();
      const position = {
        left: window.screenX + left,
        top: window.screenY + top,
        width: config.width,
        height: config.height
      };
      await popouts.open(config.key, config.title, position, () => {
        if (app.element !== element || !element.isConnected || !isEnabled()) return;

        // Keep the dock location and satisfy core layout lookups while the live toolbar is away.
        const anchor = document.createElement("span");
        anchor.id = element.id;
        anchor.className = "sidebar-window-toolbar-anchor";
        anchor.hidden = true;

        const stopListening = config.onDetach?.(element);

        function restore() {
          stopListening?.();
          detached = false;
          anchor.replaceWith(element);
          element.classList.remove(config.className);
          syncButton(app, element);
          config.onRestore?.(app);
        }

        detached = true;
        element.before(anchor);
        element.classList.add(config.className);
        config.syncOpenAllButton?.(element, detached, opening);
        return { element, restore };
      });
    } catch (error) {
      console.error(`Sidebar Window | Could not open ${config.title}`, error);
    } finally {
      opening = false;
      syncButton(app, element);
    }
  }

  Hooks.once("init", () => {
    game.settings.register(moduleId, setting, {
      name: `Enable ${config.title} popout`,
      hint: `Show a popout button for ${config.title}. Turning this off docks any open popup.`,
      scope: "user",
      config: true,
      type: Boolean,
      default: true,
      onChange() {
        if (detached && !isEnabled()) dock();
        const app = ui[config.key];
        if (app?.rendered) syncButton(app, app.element);
      }
    });
  });

  Hooks.on(config.hook, (app, element) => {
    if (ui[config.key] === app) syncButton(app, element);
  });

  return () => open(ui[config.key]);
}

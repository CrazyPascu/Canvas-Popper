const OPEN_ICON = "fa-arrow-up-right-from-square";
const RETURN_ICON = "fa-arrow-right-to-bracket";

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
    insertButton: (element, button) => element.querySelector("#performance-stats").append(button)
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

        function restore() {
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

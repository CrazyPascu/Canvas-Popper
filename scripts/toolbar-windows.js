const OPEN_ICON = "fa-arrow-up-right-from-square";
const RETURN_ICON = "fa-arrow-right-to-bracket";

export function registerToolbarWindows(moduleId, buttons) {
  registerToolbarWindow({
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
  }, moduleId, buttons);

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

  registerToolbarWindow({
    key: "hotbar",
    hook: "renderHotbar",
    title: "Hotbar",
    className: "sidebar-window-hotbar",
    width: 600,
    height: 110,
    insertButton: (element, button) => element.append(button),
    onRestore(app) {
      app._onResize();
      // Foundry calculates the docked hotbar offset from the current compact chat layout.
      if (ui.chat?.rendered) ui.chat._toggleNotifications();
    }
  }, moduleId, buttons);

  registerToolbarWindow({
    key: "players",
    hook: "renderPlayers",
    title: "Players",
    className: "sidebar-window-players",
    width: 250,
    height: 240,
    insertButton: (element, button) => element.querySelector("#performance-stats").append(button)
  }, moduleId, buttons);
}

function registerToolbarWindow(config, moduleId, { createButton, labelButton }) {
  let detached;
  let opening = false;
  const setting = `${config.key}Popout`;
  const openLabel = `Open ${config.title} in a separate window`;
  const returnLabel = `Return ${config.title} to Foundry`;

  function isEnabled() {
    return game.settings.get(moduleId, setting);
  }

  function dock() {
    const { popup, restore } = detached;
    restore();
    popup.close();
  }

  function syncButton(app, element) {
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
    if (opening || detached || !isEnabled()) return;
    const { element } = app;
    opening = true;
    syncButton(app, element);

    let popup;
    try {
      const { left, top } = element.getBoundingClientRect();
      popup = await foundry.applications.detached.openWindow({
        id: `sidebar-window-${config.key}-${foundry.utils.randomID()}`,
        position: {
          left: window.screenX + left,
          top: window.screenY + top,
          width: config.width,
          height: config.height
        }
      });
      if (app.element !== element || !element.isConnected || !isEnabled()) {
        popup.close();
        return;
      }
      popup.document.title = config.title;

      // Keep the dock location and satisfy core layout lookups while the live toolbar is away.
      const anchor = document.createElement("span");
      anchor.id = element.id;
      anchor.className = "sidebar-window-toolbar-anchor";
      anchor.hidden = true;

      function restore() {
        if (detached?.popup !== popup) return;
        detached = undefined;
        popup.removeEventListener("pagehide", restore);
        anchor.replaceWith(element);
        element.classList.remove(config.className);
        syncButton(app, element);
        config.onRestore?.(app);
      }

      detached = { popup, restore };
      popup.addEventListener("pagehide", restore, { once: true });
      element.before(anchor);
      element.classList.add(config.className);
      popup.document.body.append(element);
      popup.focus();
    } catch (error) {
      detached?.restore();
      popup?.close();
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
  Hooks.on("closeDetachedWindow", (_id, popup) => {
    if (detached?.popup === popup) detached.restore();
  });
  window.addEventListener("pagehide", () => detached?.popup.close());
}

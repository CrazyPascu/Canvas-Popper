export function registerSidebarDialogPlacement(getPopup) {
  const application = foundry.applications.api.ApplicationV2.prototype;
  const configure = application._configureRenderOptions;
  application._configureRenderOptions = function(options) {
    const destination = this.options.canvasPopperSidebarDialog;
    if (options.isFirstRender && destination) {
      const popup = getPopup(destination.kind);
      if (popup?.id === destination.windowId && !popup.closed) (options.window ??= {}).windowId = popup.id;
    }
    return configure.call(this, options);
  };
}

export function sidebarDialogOptions(popup, kind, options = {}) {
  return {
    canvasPopperSidebarDialog: { kind, windowId: popup.id },
    classes: [...new Set([...(options.classes ?? []), "sidebar-window-dialog"])]
  };
}

export function isDetachedSidebarSource(popup, target) {
  return popup && !popup.closed && target?.ownerDocument?.defaultView === popup && ui.sidebar.element.contains(target);
}

export function registerDnd5eRollDialogs(getPopup) {
  const chatAttackWindows = new WeakMap();
  Hooks.on("dnd5e.preRoll", (config, dialog) => {
    const popup = getPopup();
    if (!popup || popup.closed) return;
    const event = config.event;
    if (!isDetachedSidebarSource(popup, event?.target) && chatAttackWindows.get(event) !== popup) return;
    const options = dialog.options ??= {};
    Object.assign(options, sidebarDialogOptions(popup, "roll", options));
  });

  Hooks.once("ready", () => {
    if (game.modules.get("midi-qol")?.active) registerMidiAttackDialogs(getPopup, chatAttackWindows);

    const tracker = ui.combat;
    const handleControl = tracker._onCombatantControl;
    tracker._onCombatantControl = function(event, target, ...args) {
      const popup = getPopup();
      const button = target ?? event.currentTarget;
      if (isDetachedSidebarSource(popup, button) && (button.dataset.control || button.dataset.action) === "rollInitiative") {
        const id = button.closest("[data-combatant-id]")?.dataset.combatantId;
        const actor = this.viewed?.combatants.get(id)?.actor;
        // D&D 5e opens this prompt without forwarding the original tracker click.
        if (actor?.rollInitiativeDialog) return actor.rollInitiativeDialog({}, { options: sidebarDialogOptions(popup, "roll") });
      }
      return handleControl.call(this, event, target, ...args);
    };
  });
}

function registerMidiAttackDialogs(getPopup, chatAttackWindows) {
  const activities = CONFIG.DND5E.activityTypes;
  const attack = (activities.midiAttack ?? activities.attack)?.documentClass?.prototype;
  const handleChatAction = attack?.onChatAction;
  const rollAttack = attack?.rollAttack;
  if (!handleChatAction || !rollAttack) return;
  let chatAttack;

  attack.onChatAction = function(event, target, message, ...args) {
    const popup = getPopup();
    const action = target?.dataset.action ?? message?.system?.getButton?.(target)?.action;
    if (!isDetachedSidebarSource(popup, target) || !/^rollAttack(?:Advantage|Disadvantage)?$/.test(action)) {
      return handleChatAction.call(this, event, target, message, ...args);
    }

    chatAttackWindows.set(event, popup);
    const previous = chatAttack;
    chatAttack = { activityUuid: this.uuid, popup };
    try {
      return handleChatAction.call(this, event, target, message, ...args);
    } finally {
      chatAttack = previous;
    }
  };

  attack.rollAttack = function(config, dialog, ...args) {
    // Midi-QOL's chat handler starts the attack before the workflow awaits, but
    // can pass a workflow without the Chat click. Route this invocation directly.
    if (chatAttack && chatAttack.activityUuid === this.uuid) {
      dialog ??= {};
      const options = dialog.options ??= {};
      Object.assign(options, sidebarDialogOptions(chatAttack.popup, "roll", options));
    }
    return rollAttack.call(this, config, dialog, ...args);
  };
}

export async function keepSidebarWindowOpen(popup) {
  // The sidebar DOM is moved separately. Register a frameless app so Foundry
  // keeps the window open after its last dialog closes.
  class SidebarDialogHost extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = { window: { frame: false, positioned: false } };

    _renderHTML() {}

    _replaceHTML(_result, element) {
      element.hidden = true;
    }
  }

  await new SidebarDialogHost().render({ force: true, window: { windowId: popup.id } });
}

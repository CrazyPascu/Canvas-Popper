const CHAT_CONTROL_IDS = new Set(["chat-message", "chat-controls", "message-modes"]);
const CORE_CHAT_CHILDREN = "#chat-message, #chat-controls, .overflow, .jump-to-bottom";

export function supportDetachedChat(popup, { showCompactChat, isChatVisible }) {
  const chat = ui.chat;
  const notifications = document.getElementById("chat-notifications");
  notifications.classList.toggle("sidebar-window-chat-hidden", !showCompactChat);

  // The compact panel shares the live composer with the sidebar and the native Chat popout.
  const restoreNotifications = overrideMethod(Object.getPrototypeOf(chat), "_shouldShowNotifications", original =>
    function (options) {
      if (this !== chat && this !== chat.popout) return original.call(this, options);
      const popoutVisible = chat.popout?.rendered && !options?.closing;
      return showCompactChat && !isChatVisible() && !popoutVisible;
    });

  // Foundry and chat add-ons such as Dice Tray look up these controls in the opener.
  const restoreLookup = overrideMethod(document, "getElementById", original => function (id) {
    const local = original.call(this, id);
    if (local || this !== document || !CHAT_CONTROL_IDS.has(id) || popup.closed) return local;
    return popup.document.getElementById(id) ?? chat.popout?.element?.querySelector(`#${id}`) ?? null;
  });

  const hook = Hooks.on("renderChatInput", (_app, elements, { previousParent }) => {
    moveChatAddons(elements["#chat-message"], previousParent, notifications);
  });
  const observer = new MutationObserver(() => {
    moveChatAddons(document.getElementById("chat-message"), notifications, notifications);
  });
  observer.observe(notifications, { childList: true });
  const restoreDiceTray = supportDiceTrayCounts(popup);

  function refresh() {
    const input = document.getElementById("chat-message");
    if (input && notifications.contains(input) !== chat._shouldShowNotifications()) {
      chat._toggleNotifications();
    }
  }

  return {
    refresh,
    setShowCompactChat(enabled) {
      showCompactChat = enabled;
      notifications.classList.toggle("sidebar-window-chat-hidden", !enabled);
      refresh();
    },
    restore(restoreSidebar) {
      restoreNotifications();
      try {
        restoreSidebar();
      } finally {
        observer.disconnect();
        Hooks.off("renderChatInput", hook);
        restoreDiceTray?.();
        restoreLookup();
        notifications.classList.remove("sidebar-window-chat-hidden");
      }
    }
  };
}

function moveChatAddons(input, source, notifications) {
  if (!input?.parentElement || !source || source === input.parentElement) return;
  if (source !== notifications && !source.classList.contains("chat-form")) return;
  const addons = Array.from(source.children).filter(child => !child.matches(CORE_CHAT_CHILDREN));
  if (addons.length) input.after(...addons);
}

function supportDiceTrayCounts(popup) {
  const tray = CONFIG.DICETRAY;
  if (!game.modules.get("dice-calculator")?.active || typeof tray?.updateDiceFlags !== "function") return;
  return overrideMethod(tray, "updateDiceFlags", original => function (quantity, formula) {
    const result = original.call(this, quantity, formula);
    const selector = CSS.escape(`dice-tray__flag--${formula}`);
    for (const flag of popup.document.querySelectorAll(`.${selector}:not(.sidebar-preview .${selector})`)) {
      flag.textContent = quantity === 0 ? "" : quantity;
      flag.classList.toggle("hide", quantity === 0);
    }
    return result;
  });
}

function overrideMethod(target, key, wrap) {
  const original = target[key];
  const own = Object.hasOwn(target, key);
  const replacement = wrap(original);
  target[key] = replacement;
  return () => {
    if (target[key] !== replacement) return;
    if (own) target[key] = original;
    else delete target[key];
  };
}

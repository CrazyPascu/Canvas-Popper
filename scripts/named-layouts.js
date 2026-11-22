import { sidebarDialogOptions } from "./sidebar-dialogs.js";

const SETTING = "namedLayouts";

export function registerNamedLayouts(moduleId, { createButton, snapshotLayout, applyLayout, isLayoutLocked, toggleLayoutLock }) {
  Hooks.once("init", () => {
    game.settings.register(moduleId, SETTING, { scope: "user", config: false, type: Array, default: [] });
  });

  return function attachLayoutActions(menu, popup) {
    const actions = document.createElement("li");
    actions.className = "sidebar-window-layout-actions";
    const saveButton = createButton("Save layout", "fa-floppy-disk");
    const loadButton = createButton("Load layout", "fa-folder-open");
    const lockButton = createButton("Lock layout", "fa-lock-open");
    actions.append(saveButton, loadButton, lockButton);
    menu.prepend(actions);
    let busy = false;

    const layouts = () => game.settings.get(moduleId, SETTING);
    const isOpen = () => actions.isConnected && !popup.closed;

    function refresh() {
      const locked = isLayoutLocked();
      saveButton.disabled = busy;
      loadButton.disabled = busy || locked || !layouts().length;
      lockButton.disabled = busy;
      lockButton.setAttribute("aria-pressed", String(locked));
      lockButton.dataset.tooltip = locked ? "Unlock layout" : "Lock layout";
      lockButton.classList.toggle("fa-lock", locked);
      lockButton.classList.toggle("fa-lock-open", !locked);
    }

    function bind(button, action) {
      button.addEventListener("click", async () => {
        if (busy || button.disabled || !isOpen()) return;
        busy = true;
        refresh();
        try {
          await action();
        } catch (error) {
          ui.notifications.error("Could not update the Canvas Popper layout.");
          console.error("Canvas Popper | Could not update the layout", error);
        } finally {
          busy = false;
          if (isOpen()) refresh();
        }
      });
    }

    function dialogOptions(id, title, content) {
      return {
        ...sidebarDialogOptions(popup, "layout"),
        id: "canvas-popper-layout-" + id,
        window: { title },
        position: { width: 380 },
        modal: true,
        content,
        no: { label: "Cancel" }
      };
    }

    async function save() {
      const input = document.createElement("input");
      input.type = "text";
      input.name = "layoutName";
      input.required = true;
      input.maxLength = 64;
      const name = await foundry.applications.api.DialogV2.confirm({
        ...dialogOptions("save", "Save layout", field("Layout name", input)),
        yes: { label: "Save", disabled: true, callback: (_event, button) => button.form.elements.layoutName.value.trim() },
        render(_event, dialog) {
          const field = dialog.element.querySelector("input[name=layoutName]");
          const confirm = dialog.element.querySelector("button[data-action=yes]");
          field.addEventListener("input", () => { confirm.disabled = !field.value.trim(); });
          field.focus();
        }
      });
      if (!name || !isOpen()) return;
      const entries = layouts().slice();
      const existing = entries.findIndex(layout => layout.name.toLowerCase() === name.toLowerCase());
      if (existing >= 0) {
        const replace = await foundry.applications.api.DialogV2.confirm({
          ...dialogOptions("replace", "Replace layout", "<p>A layout already uses this name. Replace it with the current layout?</p>"),
          yes: { label: "Replace" }
        });
        if (!replace || !isOpen()) return;
      }
      const layout = { name, ...snapshotLayout() };
      if (existing >= 0) entries[existing] = layout;
      else entries.push(layout);
      await game.settings.set(moduleId, SETTING, entries);
    }

    async function load() {
      const entries = layouts();
      const select = document.createElement("select");
      select.name = "layoutIndex";
      entries.forEach(({ name }, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = name;
        select.append(option);
      });
      const layout = await foundry.applications.api.DialogV2.confirm({
        ...dialogOptions("load", "Load layout", field("Layout", select)),
        yes: { label: "Load", callback: (_event, button) => entries[Number(button.form.elements.layoutIndex.value)] }
      });
      if (layout && isOpen() && !isLayoutLocked()) applyLayout(layout);
    }

    bind(saveButton, save);
    bind(loadButton, load);
    bind(lockButton, toggleLayoutLock);
    refresh();
    return { refresh, dispose: () => actions.remove() };
  };
}

function field(label, control) {
  const wrapper = document.createElement("div");
  const group = document.createElement("label");
  group.className = "form-group";
  group.append(label, control);
  wrapper.append(group);
  return wrapper;
}


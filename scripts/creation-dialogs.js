import { isDetachedSidebarSource, sidebarDialogOptions } from "./sidebar-dialogs.js";

export function registerSidebarCreationDialogs(getPopup) {
  const { api, sidebar, handlebars, ux } = foundry.applications;
  const { Folder } = foundry.documents;
  const { CompendiumCollection } = foundry.documents.collections;

  function routeAction(Directory, action, open) {
    const original = Directory.prototype[action];
    Directory.prototype[action] = function(event, target, ...args) {
      const popup = getPopup();
      if (!isDetachedSidebarSource(popup, target)) {
        return original.call(this, event, target, ...args);
      }
      const { folderId } = target.closest(".directory-item")?.dataset ?? {};
      return open.call(this, event, folderId ?? null, sidebarDialogOptions(popup, "creation"));
    };
  }

  function creationOperation(directory) {
    return directory.collection instanceof CompendiumCollection ? { pack: directory.collection.collection } : {};
  }

  routeAction(sidebar.DocumentDirectory, "_onCreateEntry", function(event, folder, options) {
    event.stopPropagation();
    return this.documentClass.createDialog({ folder }, creationOperation(this), {
      ...options,
      position: { width: 320 }
    });
  });

  routeAction(sidebar.DocumentDirectory, "_onCreateFolder", function(event, folder, options) {
    event.stopPropagation();
    return Folder.implementation.createDialog({ folder, type: this.documentName }, creationOperation(this), options);
  });

  routeAction(sidebar.tabs.CompendiumDirectory, "_onCreateFolder", function(event, folder, options) {
    event.stopPropagation();
    return Folder.implementation.createDialog({ folder, type: "Compendium" }, {}, options);
  });

  routeAction(sidebar.tabs.CompendiumDirectory, "_onCreateEntry", async function(_event, folder, options) {
    // Foundry's compendium action builds its own prompt. Use the same form and creation API.
    const types = CONST.COMPENDIUM_DOCUMENT_TYPES.map(value => ({
      value,
      label: game.i18n.localize(CONFIG[value].documentClass.metadata.label)
    }));
    game.i18n.sortObjects(types, "label");
    const folders = game.packs._formatFolderSelectOptions();
    const content = document.createElement("div");
    content.innerHTML = await handlebars.renderTemplate("templates/sidebar/compendium-create.hbs", {
      types, folders, folder, hasFolders: folders.length
    });
    const metadata = await api.DialogV2.prompt({
      ...options,
      content,
      id: "canvas-popper-create-compendium",
      window: { title: "COMPENDIUM.Create" },
      position: { width: 480 },
      ok: {
        label: "COMPENDIUM.Create",
        callback: (_event, button) => new ux.FormDataExtended(button.form).object
      }
    });
    if (!metadata) return;
    const targetFolder = metadata.folder;
    delete metadata.folder;
    if (!metadata.label) {
      const count = game.packs.size;
      metadata.label = game.i18n.format(count ? "DOCUMENT.NewCount" : "DOCUMENT.New", {
        count: count + 1,
        type: game.i18n.localize("PACKAGE.TagCompendium")
      });
    }
    const pack = await CompendiumCollection.createCompendium(metadata);
    if (targetFolder) await pack.setFolder(targetFolder);
  });
}

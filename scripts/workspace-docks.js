import { installDockSplitter, setSplitterLocked } from "./workspace-dock-splitter.js";

export const workspacePositions = ["top", "left", "center", "right", "bottom"];

function moveNode(parent, node, before = null) {
  if (node.parentNode === parent && node.nextElementSibling === before) return;
  if (parent.moveBefore && node.isConnected && node.ownerDocument === parent.ownerDocument) {
    parent.moveBefore(node, before);
  } else parent.insertBefore(node, before);
}

export function createWorkspaceDocks(popup, order, defaults, onChange, initiallyLocked) {
  const { document } = popup;
  const layout = document.createElement("div");
  layout.className = "canvas-popper-workspace";
  let locked = initiallyLocked;
  const regions = new Map();
  const widgets = new Map();
  let cancelInteraction;

  function setInteraction(cancel) {
    if (cancel && (locked || cancelInteraction)) return false;
    cancelInteraction = cancel;
    return true;
  }

  for (const position of workspacePositions) {
    const slot = document.createElement("div");
    slot.className = "canvas-popper-workspace-slot";
    slot.dataset.position = position;
    const region = document.createElement("div");
    region.className = "canvas-popper-workspace-region";
    region.dataset.position = position;
    region.dataset.axis = position === "left" || position === "right" ? "y" : "x";
    region.dataset.label = position[0].toUpperCase() + position.slice(1);
    slot.append(region);
    if (position !== "center") {
      const edge = document.createElement("div");
      edge.className = "canvas-popper-workspace-edge";
      edge.setAttribute("aria-label", "Resize " + region.dataset.label + " dock");
      slot.append(edge);
      applyDockSize(region, order.sizes[position]?.dock);
      installDockSplitter(popup, edge, () => locked || cancelInteraction ? null : resizeDock(region), setInteraction);
    }
    layout.append(slot);
    regions.set(position, region);
  }
  document.body.append(layout);
  setLocked(locked);

  function setLocked(value) {
    if (value) cancelInteraction?.();
    locked = value;
    for (const separator of layout.querySelectorAll(".canvas-popper-workspace-edge, .canvas-popper-workspace-splitter")) {
      setSplitterLocked(separator, value);
    }
    for (const { handle } of widgets.values()) handle.disabled = value;
  }

  function mount(key, label, element) {
    if (widgets.has(key)) return;
    cancelInteraction?.();
    let position = workspacePositions.find(dock => order[dock].includes(key));
    if (!position) {
      position = defaults[key];
      order[position].push(key);
    }
    const region = regions.get(position);
    const shell = document.createElement("div");
    shell.className = "canvas-popper-workspace-widget";
    shell.dataset.widget = key;

    const handle = document.createElement("button");
    handle.type = "button";
    handle.disabled = locked;
    handle.className = "canvas-popper-workspace-handle";
    handle.title = "Drag to move " + label + ". Use the arrow keys to reorder, or Alt+Arrow / Alt+Home to change docks.";
    handle.setAttribute("aria-label", "Move " + label);
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-grip";
    icon.setAttribute("aria-hidden", "true");
    handle.append(icon, label);
    const splitter = document.createElement("div");
    splitter.className = "canvas-popper-workspace-splitter";
    splitter.setAttribute("aria-label", "Resize " + label);
    splitter.title = "Resize " + label + ". Hold Shift to also resize the next widget. Right-click or press Delete to reset.";
    shell.append(handle, splitter);
    const dockOrder = order[position];
    const nextKey = dockOrder.slice(dockOrder.indexOf(key) + 1).find(entry => widgets.has(entry));
    moveNode(region, shell, widgets.get(nextKey)?.shell);
    moveNode(shell, element, splitter);
    applyWidgetSize(shell, order.sizes[position]?.[key]);
    widgets.set(key, { shell, handle });
    installDockSplitter(popup, splitter, event => {
      if (locked || cancelInteraction) return;
      if (event?.shiftKey && event.key !== "Delete" && shell.nextElementSibling) return resizeWidgets(shell);
      return resizeWidget(shell);
    }, setInteraction);
    setSplitterLocked(splitter, locked);
    updateSplitterOrientation(shell);
    handle.addEventListener("pointerdown", event => startDrag(event, shell, label));
    handle.addEventListener("keydown", event => moveWithKeyboard(event, shell, handle));
  }

  function remove(key) {
    cancelInteraction?.();
    widgets.get(key)?.shell.remove();
    widgets.delete(key);
  }

  function saveOrder(region) {
    const position = region.dataset.position;
    const visible = [...region.children].map(shell => shell.dataset.widget);
    const present = new Set(visible);
    const previous = order[position];
    let index = 0;
    const next = previous.map(key => present.has(key) ? visible[index++] : key);
    if (next.every((key, i) => key === previous[i])) return;
    order[position] = next;
    onChange(order);
  }

  function changeDock(shell, destination) {
    const origin = shell.parentElement;
    if (origin === destination) return;
    const key = shell.dataset.widget;
    const sourceOrder = order[origin.dataset.position];
    sourceOrder.splice(sourceOrder.indexOf(key), 1);
    order[destination.dataset.position].push(key);
    moveNode(destination, shell);
    applyWidgetSize(shell, order.sizes[destination.dataset.position]?.[key]);
    updateSplitterOrientation(shell);
    shell.scrollIntoView({ block: "nearest", inline: "nearest" });
    onChange(order);
  }

  function updateSplitterOrientation(shell) {
    const orientation = shell.parentElement.dataset.axis === "x" ? "vertical" : "horizontal";
    shell.lastElementChild.setAttribute("aria-orientation", orientation);
  }

  function applyWidgetSize(shell, preference) {
    const individual = preference?.size != null;
    const size = individual ? preference.size : preference;
    shell.toggleAttribute("data-sized", size != null);
    shell.toggleAttribute("data-individual-size", individual);
    if (size == null) shell.style.removeProperty("--workspace-widget-size");
    else shell.style.setProperty("--workspace-widget-size", size + "px");
  }

  function applyDockSize(region, size) {
    const slot = region.parentElement;
    slot.toggleAttribute("data-sized", size != null);
    if (size == null) slot.style.removeProperty("--workspace-dock-size");
    else slot.style.setProperty("--workspace-dock-size", size + "px");
  }

  function resizeWidget(shell) {
    const region = shell.parentElement;
    const { axis, position } = region.dataset;
    const dimension = axis === "x" ? "width" : "height";
    const clientSize = axis === "x" ? region.clientWidth : region.clientHeight;
    const key = shell.dataset.widget;
    const sizes = order.sizes[position] ??= {};
    const value = Math.round(shell.getBoundingClientRect()[dimension]);
    // Keep the size of the Sidebar when it would normally fill the available row width.
    const growing = [...region.children].find(widget => widget !== shell &&
      Number(popup.getComputedStyle(widget).flexGrow) > 0);
    const growingKey = growing?.dataset.widget;
    const growingSize = growing && Math.round(growing.getBoundingClientRect()[dimension]);
    return {
      axis, value, direction: 1,
      min: Math.min(axis === "x" ? 100 : 72, value),
      max: Math.max(value, clientSize),
      apply(size) {
        if (growing) applyWidgetSize(growing, growingSize);
        applyWidgetSize(shell, { size });
      },
      commit(size) {
        if (growing) sizes[growingKey] = growingSize;
        sizes[key] = { size };
        onChange(order);
      },
      restore() {
        if (growing) applyWidgetSize(growing, sizes[growingKey]);
        applyWidgetSize(shell, sizes[key]);
      },
      reset() {
        if (sizes[key] == null) return;
        delete sizes[key];
        applyWidgetSize(shell);
        onChange(order);
      }
    };
  }

  function resizeWidgets(shell) {
    const next = shell.nextElementSibling;
    if (!next) return;
    const { axis, position } = shell.parentElement.dataset;
    const dimension = axis === "x" ? "width" : "height";
    const preferredMin = axis === "x" ? 100 : 72;
    const value = Math.round(shell.getBoundingClientRect()[dimension]);
    const nextSize = Math.round(next.getBoundingClientRect()[dimension]);
    const total = value + nextSize;
    const firstKey = shell.dataset.widget;
    const nextKey = next.dataset.widget;
    const sizes = order.sizes[position] ??= {};
    const asPreference = (key, size) => sizes[key]?.size == null ? size : { size };
    return {
      axis, value, direction: 1,
      min: Math.min(preferredMin, value),
      max: total - Math.min(preferredMin, nextSize),
      apply(size) {
        applyWidgetSize(shell, asPreference(firstKey, size));
        applyWidgetSize(next, asPreference(nextKey, total - size));
      },
      commit(size) {
        sizes[firstKey] = asPreference(firstKey, size);
        sizes[nextKey] = asPreference(nextKey, total - size);
        onChange(order);
      },
      restore() {
        applyWidgetSize(shell, sizes[firstKey]);
        applyWidgetSize(next, sizes[nextKey]);
      }
    };
  }

  function resizeDock(region) {
    if (!region.childElementCount) return;
    const { position } = region.dataset;
    const opposite = { left: "right", right: "left", top: "bottom", bottom: "top" }[position];
    const sharedAxis = regions.get(opposite).childElementCount > 0;
    const horizontal = position === "left" || position === "right";
    const dimension = horizontal ? "width" : "height";
    const maximum = horizontal ? (sharedAxis ? 0.4 : 0.6) : (sharedAxis ? 0.44 : 0.6);
    const value = Math.round(region.getBoundingClientRect()[dimension]);
    return {
      axis: horizontal ? "x" : "y", value,
      direction: position === "left" || position === "top" ? 1 : -1,
      min: Math.min(horizontal ? 96 : 72, value),
      max: Math.max(value, Math.floor(layout.getBoundingClientRect()[dimension] * maximum)),
      apply: size => applyDockSize(region, size),
      commit(size) {
        (order.sizes[position] ??= {}).dock = size;
        onChange(order);
      },
      restore: () => applyDockSize(region, order.sizes[position]?.dock)
    };
  }

  function moveWithKeyboard(event, shell, handle) {
    if (locked || cancelInteraction) return;
    const { key, altKey } = event;
    if (altKey) {
      const position = { ArrowUp: "top", ArrowRight: "right", ArrowDown: "bottom", ArrowLeft: "left", Home: "center" }[key];
      if (!position) return;
      event.preventDefault();
      changeDock(shell, regions.get(position));
    } else {
      const region = shell.parentElement;
      const [previous, next] = region.dataset.axis === "y" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
      if (key !== previous && key !== next) return;
      event.preventDefault();
      const neighbor = key === previous ? shell.previousElementSibling : shell.nextElementSibling;
      if (!neighbor) return;
      moveNode(region, shell, key === previous ? neighbor : neighbor.nextElementSibling);
      saveOrder(region);
    }
    handle.focus({ preventScroll: true });
    handle.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function startDrag(event, shell, label) {
    if (locked || cancelInteraction || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const { clientX: startX, clientY: startY, pointerId } = event;
    const origin = shell.parentElement;
    const initialNext = shell.nextElementSibling;
    const vertical = origin.dataset.axis === "y";
    const axis = vertical ? "clientY" : "clientX";
    const scrollAxis = vertical ? "scrollTop" : "scrollLeft";
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    let pointer = event;
    let previousCoordinate = pointer[axis] + origin[scrollAxis];
    let target;
    let badge;
    let frame;

    function preview() {
      const { clientX, clientY } = pointer;
      badge.style.transform = "translate(" + clientX + "px, " + clientY + "px)";
      const nextTarget = document.elementFromPoint(clientX, clientY)?.closest(".canvas-popper-workspace-region");
      if (target !== nextTarget) {
        target?.removeAttribute("data-target");
        target = nextTarget;
        target?.setAttribute("data-target", "");
      }

      const coordinate = pointer[axis] + origin[scrollAxis];
      const forward = coordinate > previousCoordinate;
      const moved = coordinate !== previousCoordinate;
      previousCoordinate = coordinate;
      if (target !== origin || !moved) return;

      let before = shell.nextElementSibling;
      let neighbor = forward ? before : shell.previousElementSibling;
      while (neighbor) {
        const { top, left, width, height } = neighbor.getBoundingClientRect();
        const middle = vertical ? top + height / 2 : left + width / 2;
        if (forward ? pointer[axis] <= middle : pointer[axis] >= middle) break;
        before = forward ? neighbor.nextElementSibling : neighbor;
        neighbor = forward ? neighbor.nextElementSibling : neighbor.previousElementSibling;
      }
      moveNode(origin, shell, before);
    }

    function scrollAtEdge() {
      if (target === origin) {
        const { top, right, bottom, left } = origin.getBoundingClientRect();
        const leading = pointer[axis] - (vertical ? top : left);
        const trailing = (vertical ? bottom : right) - pointer[axis];
        const previousScroll = origin[scrollAxis];
        if (leading < 28) origin[scrollAxis] -= Math.min(12, 28 - leading);
        if (trailing < 28) origin[scrollAxis] += Math.min(12, 28 - trailing);
        if (origin[scrollAxis] !== previousScroll) preview();
      }
      frame = popup.requestAnimationFrame(scrollAtEdge);
    }

    function move(nextPointer) {
      if (nextPointer.pointerId !== pointerId) return;
      pointer = nextPointer;
      if (!badge) {
        if (Math.hypot(pointer.clientX - startX, pointer.clientY - startY) < 4) return;
        layout.dataset.dragging = "";
        shell.dataset.grabbed = "";
        badge = document.createElement("div");
        badge.className = "canvas-popper-workspace-drag-label";
        badge.setAttribute("aria-hidden", "true");
        badge.textContent = label;
        layout.append(badge);
        frame = popup.requestAnimationFrame(scrollAtEdge);
      }
      preview();
    }

    function finish() {
      cancelInteraction = undefined;
      listeners.abort();
      if (layout.hasPointerCapture(pointerId)) layout.releasePointerCapture(pointerId);
      if (frame) popup.cancelAnimationFrame(frame);
      target?.removeAttribute("data-target");
      layout.removeAttribute("data-dragging");
      shell.removeAttribute("data-grabbed");
      badge?.remove();
    }

    function cancel() {
      moveNode(origin, shell, initialNext);
      finish();
    }

    function drop(nextPointer) {
      if (nextPointer.pointerId !== pointerId) return;
      if (badge) move(nextPointer);
      if (target !== origin) moveNode(origin, shell, initialNext);
      finish();
      if (target === origin) saveOrder(origin);
      else if (target) changeDock(shell, target);
    }

    layout.setPointerCapture(pointerId);
    cancelInteraction = cancel;
    layout.addEventListener("pointermove", move, options);
    layout.addEventListener("pointerup", drop, options);
    for (const type of ["pointercancel", "lostpointercapture"]) {
      layout.addEventListener(type, pointerEvent => {
        if (pointerEvent.pointerId === pointerId) cancel();
      }, options);
    }
    popup.addEventListener("blur", cancel, options);
    popup.addEventListener("resize", cancel, options);
    popup.addEventListener("pagehide", cancel, options);
    document.addEventListener("keydown", keyEvent => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      cancel();
    }, options);
  }

  function applyLayout() {
    cancelInteraction?.();
    for (const [position, region] of regions) {
      const sizes = order.sizes[position];
      applyDockSize(region, sizes?.dock);
      let before = null;
      // Walk backwards so each existing widget can stay in place when already in order.
      for (const key of order[position].slice().reverse()) {
        const shell = widgets.get(key)?.shell;
        if (!shell) continue;
        moveNode(region, shell, before);
        applyWidgetSize(shell, sizes?.[key]);
        updateSplitterOrientation(shell);
        before = shell;
      }
    }
  }

  return { mount, remove, setLocked, applyLayout };
}


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
  const fitObserver = new ResizeObserver(entries => {
    for (const { target } of entries) fitRegion(target);
  });
  for (const region of regions.values()) fitObserver.observe(region);
  popup.addEventListener("pagehide", () => fitObserver.disconnect(), { once: true });
  setLocked(locked);

  function setLocked(value) {
    if (value) cancelInteraction?.();
    locked = value;
    for (const separator of layout.querySelectorAll(".canvas-popper-workspace-edge, .canvas-popper-workspace-splitter")) {
      setSplitterLocked(separator, value);
    }
    for (const { handle } of widgets.values()) handle.disabled = value;
    for (const region of regions.values()) fitRegion(region);
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
    fitRegion(region);
    installDockSplitter(popup, splitter, event => {
      if (locked || cancelInteraction) return;
      const paired = Boolean(event?.shiftKey && event.key !== "Delete" && shell.nextElementSibling);
      return resizeWidget(shell, paired);
    }, setInteraction);
    setSplitterLocked(splitter, locked);
    updateSplitterOrientation(shell);
    handle.addEventListener("pointerdown", event => startDrag(event, shell, label));
    handle.addEventListener("keydown", event => moveWithKeyboard(event, shell, handle));
  }

  function remove(key) {
    cancelInteraction?.();
    const shell = widgets.get(key)?.shell;
    const region = shell?.parentElement;
    shell?.remove();
    widgets.delete(key);
    if (region) fitRegion(region);
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
    fitRegion(origin);
    fitRegion(destination);
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

  function fitRegion(region) {
    const shells = [...region.children];
    const vertical = region.dataset.axis === "y";
    const dimension = vertical ? "height" : "width";
    const budget = vertical ? region.clientHeight : region.clientWidth;
    if (!budget || !shells.length) return;

    // Measure the automatic sizes without any saved basis or the current fit limits.
    region.dataset.measuring = "";
    const minimums = shells.map(shell => Math.floor(shell.getBoundingClientRect()[dimension] / 2));
    region.removeAttribute("data-measuring");
    const totalMinimum = minimums.reduce((total, size) => total + size, 0);
    // If the window itself shrinks past the minimums, keep every widget inside the dock.
    const scale = totalMinimum > budget ? budget / totalMinimum : 1;
    shells.forEach((shell, index) => {
      const minimum = Math.floor(minimums[index] * scale) + "px";
      if (shell.style.getPropertyValue("--workspace-widget-min") !== minimum) {
        shell.style.setProperty("--workspace-widget-min", minimum);
      }
    });
  }

  function resizeWidget(shell, paired = false) {
    const region = shell.parentElement;
    const { axis, position } = region.dataset;
    const dimension = axis === "x" ? "width" : "height";
    fitRegion(region);
    const budget = axis === "x" ? region.clientWidth : region.clientHeight;
    const sizes = order.sizes[position] ??= {};
    const shells = [...region.children];
    const index = shells.indexOf(shell);
    const metrics = widget => ({
      widget,
      key: widget.dataset.widget,
      size: widget.getBoundingClientRect()[dimension],
      min: parseFloat(widget.style.getPropertyValue("--workspace-widget-min")) || 0
    });
    const current = metrics(shell);
    const value = Math.round(current.size);
    const neighbors = paired ? [metrics(shell.nextElementSibling)]
      : [...shells.slice(index + 1), ...shells.slice(0, index).reverse()].map(metrics);
    const occupied = neighbors.reduce((total, neighbor) => total + neighbor.size, current.size);
    const minimum = neighbors.reduce((total, neighbor) => total + neighbor.min, 0);
    const preference = (key, size) => sizes[key]?.size == null ? size : { size };

    function resize(size, write) {
      write(current, paired ? preference(current.key, size) : { size });
      let excess = size - value - Math.max(0, budget - occupied);
      for (const neighbor of neighbors) {
        const change = paired ? size - value : Math.max(0, Math.min(excess, neighbor.size - neighbor.min));
        excess -= change;
        write(neighbor, preference(neighbor.key, neighbor.size - change));
      }
    }

    return {
      axis, value, direction: 1,
      min: Math.min(current.min, value),
      max: Math.max(value, Math.floor((paired ? occupied : budget) - minimum)),
      apply: size => resize(size, (entry, next) => applyWidgetSize(entry.widget, next)),
      commit(size) {
        resize(size, (entry, next) => { sizes[entry.key] = next; });
        onChange(order);
      },
      restore() {
        for (const { widget, key } of [current, ...neighbors]) applyWidgetSize(widget, sizes[key]);
      },
      reset() {
        if (sizes[current.key] == null) return;
        delete sizes[current.key];
        applyWidgetSize(shell);
        onChange(order);
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
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    let pointer = event;
    let previousCoordinate = pointer[axis];
    let target;
    let badge;

    function preview() {
      const { clientX, clientY } = pointer;
      badge.style.transform = "translate(" + clientX + "px, " + clientY + "px)";
      const nextTarget = document.elementFromPoint(clientX, clientY)?.closest(".canvas-popper-workspace-region");
      if (target !== nextTarget) {
        target?.removeAttribute("data-target");
        target = nextTarget;
        target?.setAttribute("data-target", "");
      }

      const coordinate = pointer[axis];
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
      }
      preview();
    }

    function finish() {
      cancelInteraction = undefined;
      listeners.abort();
      if (layout.hasPointerCapture(pointerId)) layout.releasePointerCapture(pointerId);
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
    for (const region of regions.values()) fitRegion(region);
  }

  return { mount, remove, setLocked, applyLayout };
}


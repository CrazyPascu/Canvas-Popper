export function setSplitterLocked(separator, locked) {
  separator.tabIndex = locked ? -1 : 0;
  separator.setAttribute("aria-disabled", String(locked));
}

export function installDockSplitter(popup, separator, getResize, setInteraction) {
  separator.tabIndex = 0;
  separator.setAttribute("role", "separator");

  function describe(resize, value = resize.value) {
    separator.setAttribute("aria-orientation", resize.axis === "x" ? "vertical" : "horizontal");
    separator.setAttribute("aria-valuemin", String(resize.min));
    separator.setAttribute("aria-valuemax", String(resize.max));
    separator.setAttribute("aria-valuenow", String(value));
  }

  function update(resize, value) {
    const size = Math.max(resize.min, Math.min(resize.max, Math.round(value)));
    if (size === resize.value) resize.restore();
    else resize.apply(size);
    describe(resize, size);
    return size;
  }

  separator.addEventListener("focus", () => {
    const resize = getResize();
    if (resize) describe(resize);
  });

  function reset(event, resize) {
    event.preventDefault();
    event.stopPropagation();
    resize.reset();
    describe(getResize());
  }

  separator.addEventListener("contextmenu", event => {
    const resize = getResize();
    if (resize?.reset) reset(event, resize);
  });

  separator.addEventListener("keydown", event => {
    const resize = getResize(event);
    if (!resize) return;
    if (event.key === "Delete" && resize.reset) return reset(event, resize);
    const [previous, next] = resize.axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const step = 12 * resize.direction;
    const values = { [previous]: resize.value - step, [next]: resize.value + step, Home: resize.min, End: resize.max };
    if (!Object.hasOwn(values, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const size = update(resize, values[event.key]);
    if (size !== resize.value) resize.commit(size);
  });

  separator.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    const resize = getResize(event);
    if (!resize) return;
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    const capture = separator.closest(".sidebar-window-detached, .canvas-popper-workspace");
    const { pointerId } = event;
    const axis = resize.axis === "x" ? "clientX" : "clientY";
    const start = event[axis];
    let size = resize.value;

    function end(commit) {
      listeners.abort();
      separator.removeAttribute("data-resizing");
      if (capture.hasPointerCapture(pointerId)) capture.releasePointerCapture(pointerId);
      setInteraction(undefined);
      if (commit && size !== resize.value) resize.commit(size);
      else {
        resize.restore();
        describe(resize);
      }
    }

    if (!setInteraction(() => end(false))) return;
    event.preventDefault();
    separator.focus({ preventScroll: true });
    describe(resize);
    separator.dataset.resizing = "";
    capture.setPointerCapture(pointerId);
    capture.addEventListener("pointermove", pointer => {
      if (pointer.pointerId === pointerId) size = update(resize, resize.value + (pointer[axis] - start) * resize.direction);
    }, options);
    capture.addEventListener("pointerup", pointer => {
      if (pointer.pointerId === pointerId) end(true);
    }, options);
    for (const type of ["pointercancel", "lostpointercapture"]) {
      capture.addEventListener(type, pointer => {
        if (pointer.pointerId === pointerId) end(false);
      }, options);
    }
    popup.addEventListener("blur", () => end(false), options);
    popup.addEventListener("resize", () => end(false), options);
    popup.document.addEventListener("keydown", key => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      end(false);
    }, options);
  });
}


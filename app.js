(() => {
  "use strict";
  const catalog = window.DECOR_CATALOG;
  const { clamp, relativeSize, positionAt, contains, validateProject, randomizePlacements, createRandomPlacements, normalizeRandomization } = window.DecorGeometry;
  const $ = id => document.getElementById(id);
  const scene = $("scene");
  const layer = $("ornament-layer");
  const storageKey = catalog.storageKey || "decor-studio.project.v1";
  const scenes = catalog.scenes || [catalog.tree];
  const sceneStorageKey = id => id === catalog.tree.id ? storageKey : `${storageKey}:${id}`;
  const copy = value => JSON.parse(JSON.stringify(value));
  let tree = copy(catalog.tree);
  let placements = [];
  let randomization = normalizeRandomization(catalog.randomization);
  let randomizationError = "";
  let selectedId = null;
  let category = "all";
  let newBallSize = "medium";
  let drag = null;
  let toastTimer;
  let resultUrl = null;
  let resultProject = null;
  let history = [];
  let future = [];
  let rotationEditing = false;
  let storageFailed = false;
  const imageCache = new Map();

  const decorationById = id => catalog.decorations.find(item => item.id === id);
  const sizeVariant = (item, sizeId) => item.sizes?.find(size => size.id === sizeId);
  const ballSizes = catalog.ballSizes || [];
  const uid = () => globalThis.crypto?.randomUUID?.() ?? `decoration-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const snapshot = () => ({ tree: copy(tree), placements: copy(placements) });
  const project = () => ({
    version: 1,
    ...(catalog.revision ? { catalogRevision: catalog.revision } : {}),
    units: "cm",
    coordinates: { origin: "top-left", anchor: "center", space: "cropped-image", normalized: true },
    tree: copy(tree),
    decorations: copy(catalog.decorations),
    randomization: copy(randomization),
    placements: copy(placements)
  });

  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3400);
  }

  function checkpoint() {
    history.push(snapshot());
    if (history.length > 50) history.shift();
    future = [];
  }

  function save() {
    try {
      localStorage.setItem(sceneStorageKey(tree.id), JSON.stringify(project()));
      localStorage.setItem(storageKey + ":active-scene", tree.id);
      $("save-status").innerHTML = '<svg class="icon"><use href="#i-check"/></svg>Сохранено в браузере';
      storageFailed = false;
    } catch {
      $("save-status").textContent = "Скачайте JSON для сохранения";
      if (!storageFailed) toast("Автосохранение недоступно. Проект можно скачать в JSON.");
      storageFailed = true;
    }
  }

  function restore(requestedSceneId) {
    try {
      const id = requestedSceneId || localStorage.getItem(storageKey + ":active-scene") || catalog.tree.id;
      tree = copy(scenes.find(scene => scene.id === id) || catalog.tree);
      const saved = localStorage.getItem(sceneStorageKey(tree.id));
      if (!saved) return;
      const restored = validateProject(JSON.parse(saved), catalog);
      tree = restored.tree;
      placements = restored.placements;
      randomization = restored.randomization;
    } catch { toast("Сохранённый проект недоступен. Можно открыть скачанный JSON."); }
  }

  function syncTree() {
    $("scene-select").value = tree.id;
    scene.setAttribute("aria-label", `${tree.name}. Перетащите сюда украшение.`);
    $("tree-height").value = tree.sizeCm.height;
    $("tree-width").value = tree.sizeCm.width;
    $("height-label").textContent = `${tree.sizeCm.height} см`;
    $("width-label").textContent = `${tree.sizeCm.width} см`;
    const bounds = $("tree-bounds");
    Object.assign(bounds.style, { left: `${tree.bounds.x * 100}%`, top: `${tree.bounds.y * 100}%`, width: `${tree.bounds.width * 100}%`, height: `${tree.bounds.height * 100}%` });
    const outline = $("tree-contour");
    outline.setAttribute("viewBox", `0 0 ${tree.crop.width} ${tree.crop.height}`);
    const points = (tree.contour || []).map(([x, y]) => `${x * tree.crop.width},${y * tree.crop.height}`).join(" ");
    outline.querySelectorAll("polygon").forEach(polygon => polygon.setAttribute("points", points));
    $("contour-button").disabled = !tree.contour?.length;
    const image = $("tree-image");
    image.alt = tree.name;
    image.src = tree.image;
    Object.assign(image.style, { width: `${tree.imageSize.width / tree.crop.width * 100}%`, left: `${-tree.crop.x / tree.crop.width * 100}%`, top: `${-tree.crop.y / tree.crop.height * 100}%` });
    $("photo-wrap").style.aspectRatio = `${tree.crop.width} / ${tree.crop.height}`;
    scene.style.aspectRatio = `${tree.crop.width} / ${tree.crop.height}`;
    fitPhoto();
  }

  function fitPhoto() {
    const area = $("canvas-area");
    const style = getComputedStyle(area);
    const availableWidth = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availableHeight = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const height = Math.min(availableHeight, availableWidth * tree.crop.height / tree.crop.width);
    $("photo-wrap").style.height = `${Math.max(1, height)}px`;
    $("photo-wrap").style.width = `${Math.max(1, height * tree.crop.width / tree.crop.height)}px`;
  }

  function renderCatalog() {
    const grid = $("decoration-grid");
    grid.replaceChildren();
    const items = catalog.decorations.filter(item => category === "all" || item.category === category);
    $("catalog-count").textContent = items.length;
    $("ball-size-picker").hidden = !items.some(item => item.sizes?.length) || !ballSizes.length;
    for (const item of items) {
      const button = document.createElement("button");
      button.className = "decoration-card";
      button.dataset.id = item.id;
      button.type = "button";
      button.title = item.name;
      const variant = sizeVariant(item, newBallSize);
      button.setAttribute("aria-label", `Добавить: ${item.name}${variant ? `, ${variant.name.toLowerCase()}, диаметр ${variant.diameterCm} см` : `, ${item.sizeCm.width} на ${item.sizeCm.height} см`}`);
      button.innerHTML = '<span class="card-add"><svg class="icon"><use href="#i-plus"/></svg></span><span class="card-image"><img draggable="false" alt=""></span><span class="card-title"></span><span class="card-size"></span>';
      button.querySelector("img").src = item.thumbnail || item.image;
      if (variant) button.querySelector("img").style.transform = `scale(${variant.diameterCm / Math.max(...ballSizes.map(size => size.diameterCm))})`;
      button.querySelector(".card-title").textContent = item.name;
      button.querySelector(".card-size").textContent = variant ? `Ø ${variant.diameterCm} см · ${variant.name.toLowerCase()}` : `${item.sizeCm.width} × ${item.sizeCm.height} см`;
      if (item.category === "interior-garlands") {
        const note = document.createElement("span");
        note.className = "card-note";
        note.textContent = "Для интерьера";
        button.append(note);
      }
      button.addEventListener("pointerdown", event => startDrag(event, item));
      button.addEventListener("click", event => {
        if (event.detail === 0) addDecoration(item);
      });
      grid.append(button);
    }
  }

  function renderBallSizePicker() {
    const options = $("ball-size-options");
    options.replaceChildren();
    for (const size of ballSizes) {
      const button = document.createElement("button");
      button.className = "ball-size-option";
      button.type = "button";
      button.dataset.sizeId = size.id;
      button.setAttribute("aria-pressed", String(size.id === newBallSize));
      button.setAttribute("aria-label", `${size.plural}, диаметр ${size.diameterCm} см`);
      const name = document.createElement("span"), diameter = document.createElement("span");
      name.textContent = size.plural; diameter.textContent = `Ø ${size.diameterCm} см`;
      button.append(name, diameter);
      button.addEventListener("click", () => { newBallSize = size.id; renderBallSizePicker(); renderCatalog(); });
      options.append(button);
    }
  }

  function render() {
    const focusedId = layer.contains(document.activeElement) ? document.activeElement.dataset.placementId : null;
    layer.replaceChildren();
    for (const p of placements) {
      const item = decorationById(p.decorationId);
      const size = relativeSize(tree, item, p);
      const button = document.createElement("button");
      button.className = `placed-ornament${p.id === selectedId ? " selected" : ""}`;
      button.type = "button";
      button.dataset.placementId = p.id;
      const variant = sizeVariant(item, p.sizeId);
      button.setAttribute("aria-label", `${item.name}${variant ? `, ${variant.name.toLowerCase()}, диаметр ${variant.diameterCm} см` : ""}. Перетащите или используйте клавиши со стрелками.`);
      button.setAttribute("aria-pressed", String(p.id === selectedId));
      if (p.sizeId) button.dataset.sizeId = p.sizeId;
      Object.assign(button.style, { left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${size.width * 100}%`, height: `${size.height * 100}%`, transform: `translate(-50%, -50%) rotate(${p.rotation}deg)` });
      const image = new Image();
      image.src = item.image;
      image.alt = "";
      image.draggable = false;
      button.append(image);
      button.addEventListener("pointerdown", event => startDrag(event, item, p));
      button.addEventListener("focus", () => { if (selectedId !== p.id) select(p.id); });
      button.addEventListener("click", event => { if (event.detail === 0) select(p.id); });
      layer.append(button);
    }
    if (focusedId) layer.querySelector(`[data-placement-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
    const count = placements.length;
    const word = count % 10 === 1 && count % 100 !== 11 ? "украшение" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "украшения" : "украшений";
    $("placement-count").textContent = `${count} ${word}`;
    $("count-dot").classList.toggle("has-items", count > 0);
    $("clear-button").disabled = count === 0;
    const ballPlacements = placements.filter(p => decorationById(p.decorationId)?.category === "balls");
    const diameters = new Map();
    let legacy = 0;
    for (const placement of ballPlacements) {
      const item = decorationById(placement.decorationId);
      const diameter = sizeVariant(item, placement.sizeId)?.diameterCm ?? item.diameterCm;
      if (diameter) diameters.set(diameter, (diameters.get(diameter) || 0) + 1);
      else legacy++;
    }
    const summary = [...diameters].sort(([a], [b]) => b - a).map(([diameter, count]) => `Ø ${diameter} см: ${count}`);
    if (legacy) summary.push(`исходный размер ${legacy}`);
    $("ball-count-summary").textContent = `Шары: ${summary.join(" · ")}`;
    $("ball-count-summary").hidden = !ballPlacements.length;
    syncRandomizationAvailability();
    syncSelection();
  }

  function select(id) {
    selectedId = id;
    for (const element of layer.children) {
      const active = element.dataset.placementId === id;
      element.classList.toggle("selected", active);
      element.setAttribute("aria-pressed", String(active));
    }
    syncSelection();
  }

  function syncSelection() {
    const selected = placements.find(p => p.id === selectedId);
    $("selection-toolbar").hidden = !selected;
    $("canvas-hint").hidden = !!selected;
    $("canvas-hint").lastChild.textContent = placements.length ? " Нажмите на украшение, чтобы изменить его" : "Перетащите первое украшение на сцену";
    if (!selected) return;
    const item = decorationById(selected.decorationId);
    $("selected-name").textContent = item.name;
    $("selected-size-label").hidden = !item.sizes?.length;
    const sizeSelect = $("selected-ball-size");
    sizeSelect.replaceChildren();
    if (!selected.sizeId && item.sizes?.length) {
      const option = document.createElement("option");
      option.value = ""; option.textContent = "Исходный"; sizeSelect.append(option);
    }
    for (const size of item.sizes || []) {
      const option = document.createElement("option");
      option.value = size.id; option.textContent = `${size.name} · Ø ${size.diameterCm} см`; sizeSelect.append(option);
    }
    sizeSelect.value = selected.sizeId || "";
    $("rotation").value = selected.rotation;
    $("rotation-value").textContent = `${selected.rotation}°`;
  }

  function commit() { render(); save(); }

  function syncRandomizationAvailability() {
    $("randomize-button").disabled = !!randomizationError || !tree.contour?.length || (randomization.source === "current" ? !placements.length : !catalog.decorations.some(item => item.randomizable !== false));
  }

  function syncRandomizationForm() {
    $("random-source").value = randomization.source;
    $("random-count-mode").value = randomization.countMode;
    $("random-count").value = randomization.count;
    $("random-min").value = randomization.minCount;
    $("random-max").value = randomization.maxCount;
    randomizationError = "";
    syncRandomizationMode();
  }

  function syncRandomizationMode() {
    const current = $("random-source").value === "current";
    const range = $("random-count-mode").value === "random";
    $("random-quantity").hidden = current;
    $("random-fixed-field").hidden = range;
    $("random-range").hidden = !range;
    $("random-count-mode").disabled = current;
    $("random-count").disabled = current || range;
    $("random-min").disabled = current || !range;
    $("random-max").disabled = current || !range;
    $("random-settings-hint").textContent = current ? "Переставит добавленные украшения, сохранив их количество, размеры и повороты." : "Новая композиция из доступных для расстановки товаров. Размеры товаров сохраняются.";
    $("random-settings-error").textContent = randomizationError;
    $("random-settings-error").hidden = !randomizationError;
    for (const id of ["random-count", "random-min", "random-max"]) $(id).setAttribute("aria-invalid", String(!$(id).disabled && !!randomizationError));
    $("randomize-button").title = current ? "Переставить текущие украшения внутри области размещения" : "Создать новую композицию из украшений каталога";
    syncRandomizationAvailability();
  }

  function readRandomizationForm() {
    const value = { ...randomization, source: $("random-source").value, countMode: $("random-count-mode").value };
    if (value.source === "catalog") {
      if (value.countMode === "fixed") value.count = Number($("random-count").value);
      else { value.minCount = Number($("random-min").value); value.maxCount = Number($("random-max").value); }
    }
    return normalizeRandomization(value);
  }

  function updateRandomization() {
    try { randomization = readRandomizationForm(); randomizationError = ""; save(); }
    catch (error) { randomizationError = error.message; }
    syncRandomizationMode();
  }

  function addDecoration(item, position, sizeId = newBallSize) {
    if (placements.length >= 1000) { toast("В проекте уже 1000 украшений."); return; }
    checkpoint();
    const offset = placements.length % 7;
    const p = { id: uid(), decorationId: item.id, x: position?.x ?? .5 + (offset % 3 - 1) * .07, y: position?.y ?? .37 + Math.floor(offset / 3) * .08, rotation: 0 };
    if (sizeVariant(item, sizeId)) p.sizeId = sizeId;
    placements.push(p);
    selectedId = p.id;
    commit();
  }

  function startDrag(event, item, placement) {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    const rect = scene.getBoundingClientRect();
    const pointer = positionAt(rect, event.clientX, event.clientY);
    drag = { pointerId: event.pointerId, item, placement, sizeId: placement ? placement.sizeId : newBallSize, startX: event.clientX, startY: event.clientY, moved: false, source: event.currentTarget, offsetX: placement ? pointer.x - placement.x : 0, offsetY: placement ? pointer.y - placement.y : 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (placement) select(placement.id);
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      const image = new Image(); image.src = drag.item.image; ghost.append(image);
      document.body.append(ghost);
      drag.ghost = ghost;
      document.body.classList.add("dragging");
      if (drag.placement) drag.source.classList.add("is-dragging");
    }
    const rect = scene.getBoundingClientRect();
    const inside = contains(rect, event.clientX, event.clientY);
    const size = relativeSize(tree, drag.item, { sizeId: drag.sizeId });
    const width = inside ? size.width * rect.width : 58;
    const height = inside ? size.height * rect.height : 68;
    const dx = inside ? drag.offsetX * rect.width : 0;
    const dy = inside ? drag.offsetY * rect.height : 0;
    Object.assign(drag.ghost.style, { width: `${width}px`, height: `${height}px`, left: `${event.clientX - dx}px`, top: `${event.clientY - dy}px`, transform: `translate(-50%, -50%) rotate(${drag.placement?.rotation ?? 0}deg)` });
    drag.ghost.classList.toggle("outside", !inside);
    scene.classList.toggle("is-over", inside);
  }

  function cancelDrag() {
    if (!drag) return;
    drag.ghost?.remove();
    drag.source.classList.remove("is-dragging");
    if (drag.source.hasPointerCapture?.(drag.pointerId)) drag.source.releasePointerCapture(drag.pointerId);
    scene.classList.remove("is-over");
    document.body.classList.remove("dragging");
    drag = null;
  }

  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    const rect = scene.getBoundingClientRect();
    const inside = contains(rect, event.clientX, event.clientY);
    cancelDrag();
    if (!current.moved) {
      if (current.placement) select(current.placement.id);
      else addDecoration(current.item, undefined, current.sizeId);
      return;
    }
    if (!inside) { if (!current.placement) toast("Перетащите украшение на фотографию сцены."); return; }
    const position = positionAt(rect, event.clientX, event.clientY);
    position.x = clamp(position.x - current.offsetX, 0, 1);
    position.y = clamp(position.y - current.offsetY, 0, 1);
    if (current.placement) {
      checkpoint();
      Object.assign(current.placement, position);
      commit();
    } else addDecoration(current.item, position, current.sizeId);
  }

  function deleteSelected() {
    if (!placements.some(p => p.id === selectedId)) return;
    checkpoint();
    placements = placements.filter(p => p.id !== selectedId);
    selectedId = null;
    commit();
  }

  function download(url, name) {
    const link = document.createElement("a"); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
  }

  function exportJson(value = project()) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    download(url, "decor-project.json");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Конфигурация проекта скачана.");
  }

  function loadImage(src) {
    if (!imageCache.has(src)) imageCache.set(src, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { imageCache.delete(src); reject(new Error("Не удалось загрузить изображение.")); };
      image.src = src;
    }));
    return imageCache.get(src);
  }

  async function generate() {
    const button = $("generate-button");
    const original = button.innerHTML;
    button.disabled = true; button.textContent = "Создаём композицию…";
    const currentProject = project();
    try {
      const currentTree = currentProject.tree;
      const canvas = document.createElement("canvas");
      canvas.width = currentTree.crop.width; canvas.height = currentTree.crop.height;
      const ctx = canvas.getContext("2d");
      const [photo] = await Promise.all([loadImage(currentTree.image), ...currentProject.placements.map(p => loadImage(decorationById(p.decorationId).image))]);
      const crop = currentTree.crop;
      ctx.drawImage(photo, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
      for (const p of currentProject.placements) {
        const item = decorationById(p.decorationId);
        const size = relativeSize(currentTree, item, p);
        const w = size.width * canvas.width, h = size.height * canvas.height;
        ctx.save(); ctx.translate(p.x * canvas.width, p.y * canvas.height); ctx.rotate(p.rotation * Math.PI / 180);
        ctx.shadowColor = "#17220c66"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;
        ctx.drawImage(await loadImage(item.image), -w / 2, -h / 2, w, h); ctx.restore();
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Не удалось сохранить изображение.");
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      resultProject = currentProject;
      $("result-image").src = resultUrl;
      $("result-dialog").showModal();
    } catch (error) { toast(error.message || "Не удалось создать композицию. Попробуйте ещё раз."); }
    finally { button.disabled = false; button.innerHTML = original; }
  }

  document.querySelectorAll(".category-tab").forEach(button => button.addEventListener("click", () => {
    category = button.dataset.category;
    document.querySelectorAll(".category-tab").forEach(tab => { const active = tab === button; tab.classList.toggle("active", active); tab.setAttribute("aria-pressed", String(active)); });
    renderCatalog();
  }));
  $("scene-select").addEventListener("change", event => {
    const next = scenes.find(scene => scene.id === event.target.value);
    if (!next || next.id === tree.id) return;
    save(); cancelDrag();
    tree = copy(next); placements = []; randomization = normalizeRandomization(catalog.randomization);
    selectedId = null; history = []; future = []; rotationEditing = false;
    restore(next.id); syncTree(); syncRandomizationForm(); commit();
  });
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", cancelDrag);
  window.addEventListener("blur", cancelDrag);
  scene.addEventListener("pointerdown", event => { if (!event.target.closest(".placed-ornament")) select(null); });
  document.addEventListener("dragstart", event => { if (event.target instanceof HTMLImageElement) event.preventDefault(); });
  $("delete-button").addEventListener("click", deleteSelected);
  $("selected-ball-size").addEventListener("change", event => {
    const selected = placements.find(p => p.id === selectedId);
    if (!selected || !sizeVariant(decorationById(selected.decorationId), event.target.value)) return;
    checkpoint(); selected.sizeId = event.target.value; commit();
  });
  $("duplicate-button").addEventListener("click", () => {
    const p = placements.find(p => p.id === selectedId);
    if (!p || placements.length >= 1000) return;
    checkpoint();
    const duplicate = { ...p, id: uid(), x: clamp(p.x + .04, 0, 1), y: clamp(p.y + .04, 0, 1) };
    placements.push(duplicate); selectedId = duplicate.id; commit();
  });
  $("rotation").addEventListener("input", event => {
    const p = placements.find(p => p.id === selectedId);
    if (!p) return;
    if (!rotationEditing) { checkpoint(); rotationEditing = true; }
    p.rotation = Number(event.target.value);
    const element = layer.querySelector(`[data-placement-id="${CSS.escape(p.id)}"]`);
    if (element) element.style.transform = `translate(-50%, -50%) rotate(${p.rotation}deg)`;
    $("rotation-value").textContent = `${p.rotation}°`;
  });
  $("rotation").addEventListener("change", () => { rotationEditing = false; save(); });
  $("clear-button").addEventListener("click", () => { if (!placements.length) return; checkpoint(); placements = []; selectedId = null; commit(); toast("Холст очищен. Ctrl / ⌘ + Z — отменить."); });
  $("dimensions-button").addEventListener("click", event => { const active = scene.classList.toggle("show-dimensions"); event.currentTarget.setAttribute("aria-pressed", String(active)); });
  $("contour-button").addEventListener("click", event => { const active = scene.classList.toggle("show-contour"); event.currentTarget.setAttribute("aria-pressed", String(active)); });
  $("randomize-button").addEventListener("click", () => {
    try {
      randomization = readRandomizationForm();
      if (randomization.source === "current" && !placements.length) return;
      const randomized = randomization.source === "current" ? randomizePlacements(tree, catalog.decorations, placements) : createRandomPlacements(tree, catalog.decorations, randomization, { createId: uid });
      checkpoint();
      placements = randomized;
      selectedId = null;
      commit();
      toast(randomization.source === "current" ? "Украшения расставлены внутри контура. Ctrl / ⌘ + Z — отменить." : `Новая композиция: ${placements.length} шт. Ctrl / ⌘ + Z — отменить.`);
    } catch (error) { toast(error.message); }
  });
  for (const id of ["random-source", "random-count-mode"]) $(id).addEventListener("change", updateRandomization);
  for (const id of ["random-count", "random-min", "random-max"]) $(id).addEventListener("input", updateRandomization);
  for (const key of ["height", "width"]) $("tree-" + key).addEventListener("change", event => {
    const value = Number(event.target.value);
    if (!event.target.checkValidity() || !value) { event.target.value = tree.sizeCm[key]; toast("Укажите размер в пределах поля."); return; }
    checkpoint(); tree.sizeCm[key] = value; syncTree(); commit();
  });
  $("export-button").addEventListener("click", () => exportJson());
  $("import-button").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Файл проекта должен быть меньше 2 МБ.");
      const restored = validateProject(JSON.parse(await file.text()), catalog);
      checkpoint(); tree = restored.tree; placements = restored.placements; randomization = restored.randomization; selectedId = null; syncTree(); syncRandomizationForm(); commit();
      toast("Проект открыт. Можно продолжить украшать.");
    } catch (error) { toast(error instanceof SyntaxError ? "Файл содержит некорректный JSON." : error.message); }
    finally { event.target.value = ""; }
  });
  $("generate-button").addEventListener("click", generate);
  $("close-result").addEventListener("click", () => $("result-dialog").close());
  $("result-dialog").addEventListener("click", event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (!contains(r, event.clientX, event.clientY)) event.currentTarget.close(); } });
  $("result-json").addEventListener("click", () => exportJson(resultProject));
  $("result-png").addEventListener("click", () => { if (resultUrl) download(resultUrl, "decor-composition.png"); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { if (drag) cancelDrag(); else select(null); return; }
    if ($("result-dialog").open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      const source = event.shiftKey ? future : history;
      const target = event.shiftKey ? history : future;
      if (!source.length) return;
      target.push(snapshot());
      const restored = source.pop(); tree = restored.tree; placements = restored.placements; selectedId = null; syncTree(); commit(); return;
    }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); return; }
    const p = placements.find(p => p.id === selectedId);
    if (!p || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); checkpoint();
    const rect = scene.getBoundingClientRect(), step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") p.x = clamp(p.x - step / rect.width, 0, 1);
    if (event.key === "ArrowRight") p.x = clamp(p.x + step / rect.width, 0, 1);
    if (event.key === "ArrowUp") p.y = clamp(p.y - step / rect.height, 0, 1);
    if (event.key === "ArrowDown") p.y = clamp(p.y + step / rect.height, 0, 1);
    commit();
  });

  for (const item of scenes) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; $("scene-select").append(option);
  }
  if (catalog.publicConstructor) {
    $("generate-button").lastChild.textContent = "Сохранить композицию";
    document.querySelector(".generate-area p").textContent = "Скачайте JSON и передайте автору";
    document.querySelector(".result-note").textContent = "Отправьте JSON автору для фотореалистичной визуализации. PNG — эскиз вашей композиции.";
  }
  restore(); syncTree(); syncRandomizationForm(); renderBallSizePicker(); renderCatalog(); render();
  new ResizeObserver(fitPhoto).observe($("canvas-area"));
  $("tree-image").addEventListener("error", () => toast("Фотография сцены не загрузилась. Проверьте папку assets."));
})();

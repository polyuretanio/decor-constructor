/* Shared by the browser and the geometry checks; no dependencies. */
(function (root) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const MAX_RANDOM_COUNT = 200;
  const DEFAULT_RANDOMIZATION = { source: "catalog", countMode: "fixed", count: 20, minCount: 10, maxCount: 40 };
  function normalizeRandomization(value = DEFAULT_RANDOMIZATION) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректные настройки случайной расстановки.");
    const settings = { ...DEFAULT_RANDOMIZATION, ...value };
    if (!["catalog", "current"].includes(settings.source) || !["fixed", "random"].includes(settings.countMode)) throw new Error("Выберите режим случайной расстановки.");
    for (const key of ["count", "minCount", "maxCount"]) {
      if (!Number.isInteger(settings[key]) || settings[key] < 1 || settings[key] > MAX_RANDOM_COUNT) throw new Error(`Количество должно быть целым числом от 1 до ${MAX_RANDOM_COUNT}.`);
    }
    if (settings.minCount > settings.maxCount) throw new Error("Минимальное количество не может быть больше максимального.");
    return { source: settings.source, countMode: settings.countMode, count: settings.count, minCount: settings.minCount, maxCount: settings.maxCount };
  }
  function decorationSize(decoration, placement = {}) {
    return decoration.sizes?.find(size => size.id === placement.sizeId)?.sizeCm ?? decoration.sizeCm;
  }
  function relativeSize(tree, decoration, placement = {}) {
    const size = decorationSize(decoration, placement);
    return {
      width: tree.bounds.width * size.width / tree.sizeCm.width,
      height: tree.bounds.height * size.height / tree.sizeCm.height
    };
  }
  function positionAt(rect, clientX, clientY) {
    return { x: clamp((clientX - rect.left) / rect.width, 0, 1), y: clamp((clientY - rect.top) / rect.height, 0, 1) };
  }
  function contains(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      if (Math.abs(cross(a, b, point)) < 1e-10 && point[0] >= Math.min(a[0], b[0]) - 1e-10 && point[0] <= Math.max(a[0], b[0]) + 1e-10 && point[1] >= Math.min(a[1], b[1]) - 1e-10 && point[1] <= Math.max(a[1], b[1]) + 1e-10) return true;
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function segmentsCross(a, b, c, d) {
    return cross(a, b, c) * cross(a, b, d) < -1e-15 && cross(c, d, a) * cross(c, d, b) < -1e-15;
  }
  function footprint(tree, decoration, placement, paddingPx = 0) {
    const size = relativeSize(tree, decoration, placement), { width, height } = tree.crop;
    const halfWidth = (size.width * width + paddingPx * 2) / 2;
    const halfHeight = (size.height * height + paddingPx * 2) / 2;
    const angle = placement.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    return [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]].map(([x, y]) => [placement.x + (x * cos - y * sin) / width, placement.y + (x * sin + y * cos) / height]);
  }
  function polygonContainsFootprint(contour, rectangle) {
    if (!rectangle.every(point => pointInPolygon(point, contour))) return false;
    for (let i = 0; i < rectangle.length; i++) {
      const a = rectangle[i], b = rectangle[(i + 1) % rectangle.length];
      if (!pointInPolygon([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], contour)) return false;
      for (let j = 0; j < contour.length; j++) if (segmentsCross(a, b, contour[j], contour[(j + 1) % contour.length])) return false;
    }
    return true;
  }
  function polygonsOverlap(a, b) {
    for (const rectangle of [a, b]) {
      for (let i = 0; i < 2; i++) {
        const p = rectangle[i], q = rectangle[i + 1], axis = [p[1] - q[1], q[0] - p[0]];
        const ap = a.map(v => v[0] * axis[0] + v[1] * axis[1]);
        const bp = b.map(v => v[0] * axis[0] + v[1] * axis[1]);
        if (Math.max(...ap) <= Math.min(...bp) || Math.max(...bp) <= Math.min(...ap)) return false;
      }
    }
    return true;
  }
  function randomizePlacements(tree, decorations, placements, { random = Math.random, maxAttempts = 700 } = {}) {
    const contour = tree.contour;
    if (!Array.isArray(contour) || contour.length < 3) throw new Error("Сначала задайте контур ёлки в конфиге.");
    const xs = contour.map(p => p[0]), ys = contour.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const items = new Map(decorations.map(item => [item.id, item]));
    const ordered = placements.map(p => {
      const item = items.get(p.decorationId);
      if (!item) throw new Error("Неизвестное украшение в проекте.");
      const size = relativeSize(tree, item, p);
      return { placement: p, item, area: size.width * size.height };
    }).sort((a, b) => b.area - a.area);
    const grid = new Map(), result = new Map();
    const cellsFor = rectangle => {
      const x = rectangle.map(p => p[0]), y = rectangle.map(p => p[1]), cells = [];
      for (let row = Math.floor(Math.min(...y) / .08); row <= Math.floor(Math.max(...y) / .08); row++) {
        for (let col = Math.floor(Math.min(...x) / .08); col <= Math.floor(Math.max(...x) / .08); col++) cells.push(`${col},${row}`);
      }
      return cells;
    };
    for (const { placement, item } of ordered) {
      let best = null, bestScore = Infinity;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = { ...placement, x: minX + random() * (maxX - minX), y: minY + random() * (maxY - minY) };
        const rectangle = footprint(tree, item, candidate, 3);
        if (!polygonContainsFootprint(contour, rectangle)) continue;
        const cells = cellsFor(rectangle), neighbors = new Set(cells.flatMap(key => grid.get(key) || []));
        const score = [...neighbors].filter(other => polygonsOverlap(rectangle, other)).length;
        if (score < bestScore) { best = { candidate, rectangle, cells }; bestScore = score; }
        if (score === 0) break;
      }
      if (!best) throw new Error(`Не удалось найти место для «${item.name}». Попробуйте ещё раз или уменьшите украшение в конфиге.`);
      result.set(placement.id, best.candidate);
      for (const key of best.cells) { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(best.rectangle); }
    }
    return placements.map(p => result.get(p.id));
  }
  function createRandomPlacements(tree, decorations, settings, { random = Math.random, createId, ...options } = {}) {
    const normalized = normalizeRandomization(settings);
    if (!decorations.length) throw new Error("В каталоге пока нет украшений.");
    const eligible = decorations.filter(item => item.randomizable !== false);
    if (!eligible.length) throw new Error("В каталоге нет украшений для случайной расстановки на ёлке.");
    const count = normalized.countMode === "fixed" ? normalized.count : normalized.minCount + Math.floor(random() * (normalized.maxCount - normalized.minCount + 1));
    const chosen = Array.from({ length: count }, (_, i) => {
      const item = eligible[Math.floor(random() * eligible.length)];
      return {
        id: createId ? createId() : `random-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        decorationId: item.id, x: .5, y: .5, rotation: 0,
        ...(item.sizes?.length ? { sizeId: item.sizes[Math.floor(random() * item.sizes.length)].id } : {})
      };
    });
    return randomizePlacements(tree, decorations, chosen, { ...options, random });
  }
  function validateProject(value, catalog) {
    const configuredScene = (catalog.scenes || [catalog.tree]).find(scene => scene.id === value?.tree?.id);
    if (!value || value.version !== 1 || !configuredScene || !Array.isArray(value.placements)) throw new Error("Это не проект Decor Studio для доступной сцены.");
    for (const key of ["width", "height"]) {
      const size = value.tree.sizeCm?.[key];
      const min = key === "height" ? 30 : 20;
      const max = key === "height" ? 1000 : 600;
      if (!Number.isFinite(size) || size < min || size > max) throw new Error("Проверьте размеры ёлки в проекте.");
    }
    if (value.placements.length > 1000) throw new Error("В проекте слишком много украшений (максимум 1000).");
    const ids = new Set();
    const placements = value.placements.map(p => {
      const item = catalog.decorations.find(item => item.id === p.decorationId);
      if (!item || typeof p.id !== "string" || !p.id || ids.has(p.id) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || !Number.isFinite(p.rotation) || p.rotation < -180 || p.rotation > 180 || (p.sizeId !== undefined && !item.sizes?.some(size => size.id === p.sizeId))) throw new Error("В проекте есть некорректное украшение, размер или координаты.");
      ids.add(p.id);
      return { id: p.id, decorationId: p.decorationId, x: p.x, y: p.y, rotation: p.rotation, ...(p.sizeId !== undefined ? { sizeId: p.sizeId } : {}) };
    });
    return { tree: { ...configuredScene, sizeCm: { ...value.tree.sizeCm } }, placements, randomization: normalizeRandomization(value.randomization ?? catalog.randomization) };
  }
  const api = { clamp, relativeSize, decorationSize, positionAt, contains, validateProject, pointInPolygon, footprint, polygonContainsFootprint, polygonsOverlap, randomizePlacements, createRandomPlacements, normalizeRandomization, DEFAULT_RANDOMIZATION, MAX_RANDOM_COUNT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DecorGeometry = api;
})(typeof window !== "undefined" ? window : globalThis);

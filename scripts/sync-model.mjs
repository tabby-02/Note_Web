// Three-way comparison is independent of transport and never writes either side.
const equal = (a, b) => a == null && b == null || Boolean(a && b && a.sha256 === b.sha256 && a.size === b.size);
export function compareFiles(local = {}, cloud = {}, baseline) {
  const paths = [...new Set([...Object.keys(local), ...Object.keys(cloud), ...Object.keys(baseline?.assets ?? {})])].sort();
  return paths.map((path) => {
    const left = local[path] ?? null, right = cloud[path] ?? null;
    const known = Boolean(baseline && !baseline.unknownPaths?.includes(path));
    const base = known ? baseline.assets[path] ?? null : null;
    const status = equal(left, right) ? 'equal' : !known ? 'unbased'
      : equal(left, base) ? 'cloud-changed' : equal(right, base) ? 'local-changed' : 'conflict';
    return { path, status, local: left && { sha256: left.sha256, size: left.size }, cloud: right && { sha256: right.sha256, size: right.size }, baselineKnown: known,
      difference: equal(left, right) ? 'equal' : !left ? 'cloud-only' : !right ? 'local-only' : 'modified' };
  });
}

export function commonBaseline(local, cloud, previous) {
  const assets = {}, unknownPaths = [];
  for (const file of compareFiles(local, cloud, previous)) {
    if (file.status === 'equal') { if (file.cloud) assets[file.path] = file.cloud; }
    else if (file.baselineKnown) { if (previous.assets[file.path]) assets[file.path] = previous.assets[file.path]; }
    else unknownPaths.push(file.path);
  }
  return { assets, unknownPaths };
}

export function noteStatus(files) {
  const changed = files.filter((file) => file.status !== 'equal');
  if (!changed.length) return 'clean';
  if (changed.some((file) => file.status === 'unbased')) return 'drift';
  if (changed.some((file) => file.status === 'conflict') || new Set(changed.map((file) => file.status)).size > 1) return 'both-changed';
  return changed[0].status;
}

export function compareTaxonomy(local, cloud) {
  const localById = new Map(local.map((node) => [node.id, node]));
  const cloudById = new Map(cloud.map((node) => [node.id, node]));
  return [...new Set([...localById.keys(), ...cloudById.keys()])].flatMap((id) => {
    const a = localById.get(id), b = cloudById.get(id);
    if (!a || !b) return [{ id, field: 'presence', local: a ? 'active' : null, cloud: b ? 'active' : null }];
    return ['title', 'kind', 'type', 'parentId', 'slug', 'position'].filter((field) => (a[field] ?? null) !== (b[field] ?? null))
      .map((field) => ({ id, field, local: a[field] ?? null, cloud: b[field] ?? null }));
  });
}

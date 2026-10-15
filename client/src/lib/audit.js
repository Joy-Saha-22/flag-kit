export function getChangedFields(before, after) {
  const beforeObject = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const afterObject = after && typeof after === 'object' && !Array.isArray(after) ? after : {};
  const fields = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]);

  return [...fields]
    .filter((field) => JSON.stringify(beforeObject[field]) !== JSON.stringify(afterObject[field]))
    .sort();
}

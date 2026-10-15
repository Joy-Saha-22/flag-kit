export function validateFlagDraft(draft) {
  const errors = {};

  if (!draft.key || draft.key.length < 2) {
    errors.key = 'Key is required.';
  }

  if (!draft.name || draft.name.trim().length < 1) {
    errors.name = 'Name is required.';
  }

  if (draft.isExperiment && !draft.goalMetricKey) {
    errors.goalMetricKey = 'Goal metric key is required for experiment flags.';
  }

  const variationKeys = new Set((draft.variations || []).map((item) => item.key));
  if ((draft.variations || []).length < 2) {
    errors.variations = 'At least two variations are required.';
  }

  if (draft.offVariation && !variationKeys.has(draft.offVariation)) {
    errors.offVariation = 'Unknown off variation.';
  }

  if (draft.defaultVariation && !variationKeys.has(draft.defaultVariation)) {
    errors.defaultVariation = 'Unknown default variation.';
  }

  return errors;
}

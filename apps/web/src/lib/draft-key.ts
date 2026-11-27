const keys = new WeakMap<object, number>();
let next = 0;

/** A key for a draft that has no id yet, the same for as long as the draft object lives, so each new draft gets a fresh form. */
export const draftKey = (draft: object) => {
  const known = keys.get(draft);
  if (known !== undefined) return `draft-${known}`;
  keys.set(draft, ++next);
  return `draft-${next}`;
};

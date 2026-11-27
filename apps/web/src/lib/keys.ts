const keys = new WeakMap<object, number>();
let next = 0;

/** A React key for an object without an id, stable for as long as the object lives. */
export const keyOf = (value: object): number => {
  let key = keys.get(value);
  if (key === undefined) {
    key = next++;
    keys.set(value, key);
  }
  return key;
};

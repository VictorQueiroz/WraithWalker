export function queryRequired<T extends Element>(
  selector: string,
  root: ParentNode = document
): T {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element as T;
}

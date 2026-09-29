import { chromium, firefox, webkit } from 'playwright';

const engines = { chromium, firefox, webkit };
const selected = process.env.BROWSER_ENGINE;
if (selected && !Object.hasOwn(engines, selected)) {
  throw new Error(`Unknown BROWSER_ENGINE: ${selected}`);
}

export function browserEngines(supported = Object.values(engines)) {
  return selected ? supported.filter((engine) => engine === engines[selected]) : supported;
}

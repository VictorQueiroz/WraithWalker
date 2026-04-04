import type { Output } from "./output.mjs";

export function createPlainOutput(): Output {
  return {
    success(message)        { console.log(message); },
    error(message)          { console.error(message); },
    warn(message)           { console.error(message); },
    heading(message)        { console.log(message); },
    keyValue(key, value)    { console.log(`${key.padEnd(12)} ${value}`); },
    info(message)           { console.log(message); },
    listItem(item)          { console.log(`  ${item}`); },
    block(content)          { console.log(content); },
    usage(message)          { console.error(message); },
  };
}

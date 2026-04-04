import type { Output } from "./output.mjs";

const PLAIN_ART = [
  "        ___        ",
  "      /     \\      ",
  "     |  . .  |     ",
  "     |   v   |     ",
  "      \\_   _/      ",
  "        | |        ",
  "       _| |_       ",
];

export function createPlainOutput(): Output {
  return {
    banner() {
      console.log();
      for (const line of PLAIN_ART) {
        console.log(line);
      }
      console.log();
      console.log("  WraithWalker");
      console.log();
    },
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

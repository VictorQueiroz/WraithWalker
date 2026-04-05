const ESC = "\x1b[";

export const ansi = {
  bold:      (s: string) => `${ESC}1m${s}${ESC}22m`,
  dim:       (s: string) => `${ESC}2m${s}${ESC}22m`,
  italic:    (s: string) => `${ESC}3m${s}${ESC}23m`,
  underline: (s: string) => `${ESC}4m${s}${ESC}24m`,

  black:   (s: string) => `${ESC}30m${s}${ESC}39m`,
  red:     (s: string) => `${ESC}31m${s}${ESC}39m`,
  green:   (s: string) => `${ESC}32m${s}${ESC}39m`,
  yellow:  (s: string) => `${ESC}33m${s}${ESC}39m`,
  blue:    (s: string) => `${ESC}34m${s}${ESC}39m`,
  magenta: (s: string) => `${ESC}35m${s}${ESC}39m`,
  cyan:    (s: string) => `${ESC}36m${s}${ESC}39m`,
  white:   (s: string) => `${ESC}37m${s}${ESC}39m`,
  gray:    (s: string) => `${ESC}90m${s}${ESC}39m`,
} as const;

export function supportsColor({
  env = process.env,
  isTTY = process.stdout.isTTY
}: {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
} = {}): boolean {
  if (env["NO_COLOR"] !== undefined) return false;
  if (env["FORCE_COLOR"] !== undefined) return true;
  if (!isTTY) return false;
  return true;
}

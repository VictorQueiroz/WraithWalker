import { ansi } from "./ansi.mjs";
import type { Theme } from "./theme.mjs";

export const wraithwalkerTheme: Theme = {
  palette: {
    success:  (s) => ansi.green(s),
    error:    (s) => ansi.red(s),
    warn:     (s) => ansi.yellow(s),
    heading:  (s) => ansi.bold(ansi.magenta(s)),
    label:    (s) => ansi.magenta(s),
    muted:    (s) => ansi.dim(s),
    accent:   (s) => ansi.bold(ansi.cyan(s)),
    usage:    (s) => ansi.dim(s),
  },
  icons: {
    success: "\u2714",
    error:   "\u2716",
    warn:    "\u26A0",
    bullet:  "\u203A",
  },
  banner: {
    art: [
      "           .       .           ",
      "       . .:::::::::::. .       ",
      "     .::::'       '::::.      ",
      "    :::'    _   _    ':::     ",
      "   ::     .' '.' '.     ::    ",
      "   :     /   _W_   \\     :    ",
      "   :    |   /   \\   |    :    ",
      "    :    \\ '     ' /    :     ",
      "     ':   '-.._..-'   :'      ",
      "       '::.       .::'        ",
      "      _..'::::::::''.._       ",
      "     '       | |       '      ",
      "            _| |_             ",
      "           |_____|            ",
    ],
    phrases: [
      "Capture the unseen, replay the forgotten.",
      "Walking through shadows of live sessions.",
      "No proxy. No build step. Just phantom files.",
      "Your network, frozen in time.",
      "Intercept. Capture. Replay. Edit.",
      "Ghosting through the network layer.",
      "Every response leaves a trace.",
      "Phantom files, real control.",
      "The network remembers what you capture.",
      "Browse once, replay forever.",
    ],
  },
  indent: "  ",
  labelWidth: 12,
};

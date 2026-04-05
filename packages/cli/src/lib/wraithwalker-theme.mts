import type { ThemeDefinition } from "./theme.mjs";

export const wraithwalkerTheme: ThemeDefinition = {
  name: "wraithwalker",
  styles: {
    success: ["green"],
    error: ["red"],
    warn: ["yellow"],
    heading: ["bold", "magenta"],
    label: ["magenta"],
    muted: ["dim"],
    accent: ["bold", "cyan"],
    usage: ["dim"]
  },
  icons: {
    success: "\u2714",
    error: "\u2716",
    warn: "\u26A0",
    bullet: "\u203A"
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
      "           |_____|            "
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
      "Browse once, replay forever."
    ]
  },
  indent: "  ",
  labelWidth: 12
};

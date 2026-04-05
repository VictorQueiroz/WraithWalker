#!/usr/bin/env node

import process from "node:process";

import { startServer } from "./server.mjs";

const rootPath = process.argv[2] || process.env.WRAITHWALKER_ROOT || process.cwd();

await startServer(rootPath);

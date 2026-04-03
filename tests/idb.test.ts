import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { IDB_NAME, IDB_STORE } from "../src/lib/constants.js";
import { idbDelete, idbGet, idbSet, openDatabase } from "../src/lib/idb.js";

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Database deletion blocked for ${name}.`));
    request.onsuccess = () => resolve();
  });
}

describe("idb helpers", () => {
  beforeEach(async () => {
    await deleteDatabase(IDB_NAME);
  });

  it("creates the configured object store", async () => {
    const database = await openDatabase();

    expect(database.objectStoreNames.contains(IDB_STORE)).toBe(true);
    database.close();
  });

  it("round-trips stored values", async () => {
    await idbSet("rootDirectory", { id: "root-1", enabled: true });

    await expect(idbGet("rootDirectory")).resolves.toEqual({ id: "root-1", enabled: true });
  });

  it("deletes stored values", async () => {
    await idbSet("rootDirectory", { id: "root-1" });
    await idbDelete("rootDirectory");

    await expect(idbGet("rootDirectory")).resolves.toBeUndefined();
  });
});

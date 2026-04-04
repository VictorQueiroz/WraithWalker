import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import { IDB_NAME, IDB_STORE, IDB_VERSION } from "./constants.js";

interface ExtensionDatabaseSchema extends DBSchema {
  [IDB_STORE]: {
    key: string;
    value: unknown;
  };
}

export function openDatabase(): Promise<IDBPDatabase<ExtensionDatabaseSchema>> {
  return openDB<ExtensionDatabaseSchema>(IDB_NAME, IDB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(IDB_STORE)) {
        database.createObjectStore(IDB_STORE);
      }
    }
  });
}

export async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  try {
    return await database.get(IDB_STORE, key) as T | undefined;
  } finally {
    database.close();
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  try {
    await database.put(IDB_STORE, value, key);
  } finally {
    database.close();
  }
}

export async function idbDelete(key: string): Promise<void> {
  const database = await openDatabase();
  try {
    await database.delete(IDB_STORE, key);
  } finally {
    database.close();
  }
}

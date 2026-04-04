import { getNativeHostConfig as defaultGetNativeHostConfig, getSiteConfigs as defaultGetSiteConfigs, setNativeHostConfig as defaultSetNativeHostConfig, setSiteConfigs as defaultSetSiteConfigs } from "./lib/chrome-storage.js";
import { queryRequired } from "./lib/dom.js";
import type { ErrorResult, NativeVerifyResult } from "./lib/messages.js";
import { normalizeSiteInput, originToPermissionPattern } from "./lib/path-utils.js";
import { ensureRootSentinel as defaultEnsureRootSentinel, loadStoredRootHandle as defaultLoadStoredRootHandle, queryRootPermission as defaultQueryRootPermission, requestRootPermission as defaultRequestRootPermission, storeRootHandleWithSentinel as defaultStoreRootHandleWithSentinel } from "./lib/root-handle.js";
import { createSiteConfig, isValidDumpAllowlistPatterns } from "./lib/site-config.js";
import type { NativeHostConfig, SiteConfig } from "./lib/types.js";

interface PermissionsApi {
  request(options: { origins: string[] }): Promise<boolean>;
  remove(options: { origins: string[] }): Promise<boolean>;
}

interface RuntimeApi {
  sendMessage(message: { type: "native.verify" }): Promise<unknown>;
}

interface ChromeApi {
  permissions: PermissionsApi;
  runtime: RuntimeApi;
}

interface OptionsDependencies {
  document?: Document;
  windowRef?: Window;
  chromeApi?: ChromeApi;
  getNativeHostConfig?: typeof defaultGetNativeHostConfig;
  getSiteConfigs?: typeof defaultGetSiteConfigs;
  setNativeHostConfig?: typeof defaultSetNativeHostConfig;
  setSiteConfigs?: typeof defaultSetSiteConfigs;
  ensureRootSentinel?: typeof defaultEnsureRootSentinel;
  loadStoredRootHandle?: typeof defaultLoadStoredRootHandle;
  queryRootPermission?: typeof defaultQueryRootPermission;
  requestRootPermission?: typeof defaultRequestRootPermission;
  storeRootHandleWithSentinel?: typeof defaultStoreRootHandleWithSentinel;
}

interface OptionsElements {
  siteForm: HTMLFormElement;
  siteOriginInput: HTMLInputElement;
  sitesList: HTMLDivElement;
  sitesEmpty: HTMLDivElement;
  chooseRootButton: HTMLButtonElement;
  reauthorizeRootButton: HTMLButtonElement;
  rootStatus: HTMLDivElement;
  rootMeta: HTMLPreElement;
  nativeForm: HTMLFormElement;
  nativeStatus: HTMLDivElement;
  flash: HTMLDivElement;
  nativeHostNameInput: HTMLInputElement;
  nativeCommandTemplateInput: HTMLInputElement;
  nativeRootPathInput: HTMLInputElement;
  verifyHelperButton: HTMLButtonElement;
}

function getErrorMessage(result: { error?: string }): string {
  return result.error || "Unknown error.";
}

function isTestMode(): boolean {
  return Boolean((globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean }).__WRAITHWALKER_TEST__);
}

function getElements(documentRef: Document): OptionsElements {
  return {
    siteForm: queryRequired<HTMLFormElement>("#site-form", documentRef),
    siteOriginInput: queryRequired<HTMLInputElement>("#site-origin", documentRef),
    sitesList: queryRequired<HTMLDivElement>("#sites-list", documentRef),
    sitesEmpty: queryRequired<HTMLDivElement>("#sites-empty", documentRef),
    chooseRootButton: queryRequired<HTMLButtonElement>("#choose-root", documentRef),
    reauthorizeRootButton: queryRequired<HTMLButtonElement>("#reauthorize-root", documentRef),
    rootStatus: queryRequired<HTMLDivElement>("#root-status", documentRef),
    rootMeta: queryRequired<HTMLPreElement>("#root-meta", documentRef),
    nativeForm: queryRequired<HTMLFormElement>("#native-form", documentRef),
    nativeStatus: queryRequired<HTMLDivElement>("#native-status", documentRef),
    flash: queryRequired<HTMLDivElement>("#flash", documentRef),
    nativeHostNameInput: queryRequired<HTMLInputElement>("#native-host-name", documentRef),
    nativeCommandTemplateInput: queryRequired<HTMLInputElement>("#native-command-template", documentRef),
    nativeRootPathInput: queryRequired<HTMLInputElement>("#native-root-path", documentRef),
    verifyHelperButton: queryRequired<HTMLButtonElement>("#verify-helper", documentRef)
  };
}

function setFlash(elements: OptionsElements, kind: string | null, message: string): void {
  elements.flash.className = kind ? `${kind}-box` : "hidden";
  elements.flash.textContent = message || "";
}

export async function initOptions({
  document: documentRef = document,
  windowRef = window,
  chromeApi = chrome as unknown as ChromeApi,
  getNativeHostConfig = defaultGetNativeHostConfig,
  getSiteConfigs = defaultGetSiteConfigs,
  setNativeHostConfig = defaultSetNativeHostConfig,
  setSiteConfigs = defaultSetSiteConfigs,
  ensureRootSentinel = defaultEnsureRootSentinel,
  loadStoredRootHandle = defaultLoadStoredRootHandle,
  queryRootPermission = defaultQueryRootPermission,
  requestRootPermission = defaultRequestRootPermission,
  storeRootHandleWithSentinel = defaultStoreRootHandleWithSentinel
}: OptionsDependencies = {}) {
  const elements = getElements(documentRef);

  function createAllowlistRow(value: string, container: HTMLDivElement): HTMLDivElement {
    const row = documentRef.createElement("div");
    row.className = "row allowlist-row";
    row.innerHTML = `
      <input class="allowlist-pattern" type="text" autocomplete="off" placeholder="\\.(js|css)$">
      <button class="danger remove-allowlist-row" type="button">-</button>
    `;
    const input = queryRequired<HTMLInputElement>(".allowlist-pattern", row);
    input.value = value;
    queryRequired<HTMLButtonElement>(".remove-allowlist-row", row).addEventListener("click", () => {
      row.remove();
      if (!container.querySelector(".allowlist-row")) {
        container.appendChild(createAllowlistRow("", container));
      }
    });
    return row;
  }

  function getAllowlistPatterns(wrapper: HTMLElement): string[] {
    const inputs = wrapper.querySelectorAll<HTMLInputElement>(".allowlist-pattern");
    return Array.from(inputs).map((input) => input.value.trim()).filter(Boolean);
  }

  function createSiteItem(siteConfig: SiteConfig): HTMLDivElement {
    const wrapper = documentRef.createElement("div");
    wrapper.className = "site-item stack tight";
    wrapper.innerHTML = `
      <div class="row spread">
        <strong>${siteConfig.origin}</strong>
        <div class="row">
          <button class="secondary save-site" type="button">Save</button>
          <button class="danger remove-site" type="button">Remove</button>
        </div>
      </div>
      <label class="stack tight">
        <span>Storage mode</span>
        <select class="site-mode">
          <option value="simple">Simple</option>
          <option value="advanced">Advanced</option>
        </select>
      </label>
      <div class="stack tight">
        <div class="row spread">
          <span>Dump allowlist patterns</span>
          <button class="secondary add-allowlist-row" type="button">+ Add pattern</button>
        </div>
        <div class="allowlist-rows"></div>
      </div>
      <div class="meta">Granted pattern: ${originToPermissionPattern(siteConfig.origin)}</div>
    `;

    const modeSelect = queryRequired<HTMLSelectElement>(".site-mode", wrapper);
    modeSelect.value = siteConfig.mode;

    const allowlistContainer = queryRequired<HTMLDivElement>(".allowlist-rows", wrapper);
    for (const pattern of siteConfig.dumpAllowlistPatterns) {
      allowlistContainer.appendChild(createAllowlistRow(pattern, allowlistContainer));
    }

    queryRequired<HTMLButtonElement>(".add-allowlist-row", wrapper).addEventListener("click", () => {
      allowlistContainer.appendChild(createAllowlistRow("", allowlistContainer));
    });

    queryRequired<HTMLButtonElement>(".save-site", wrapper).addEventListener("click", async () => {
      try {
        await updateSite(siteConfig.origin, {
          mode: modeSelect.value as SiteConfig["mode"],
          dumpAllowlistPatterns: getAllowlistPatterns(wrapper)
        });
        setFlash(elements, "success", `Updated ${siteConfig.origin}.`);
      } catch (error) {
        setFlash(elements, "error", error instanceof Error ? error.message : String(error));
      }
    });

    queryRequired<HTMLButtonElement>(".remove-site", wrapper).addEventListener("click", async () => {
      await removeSite(siteConfig.origin);
    });
    return wrapper;
  }

  async function renderSites(): Promise<void> {
    const sites = await getSiteConfigs();
    elements.sitesList.replaceChildren(...sites.map(createSiteItem));
    elements.sitesEmpty.classList.toggle("hidden", sites.length > 0);
  }

  async function renderRootState(): Promise<void> {
    const rootHandle = await loadStoredRootHandle();
    if (!rootHandle) {
      elements.rootStatus.className = "muted-box";
      elements.rootStatus.textContent = "No root directory selected.";
      elements.rootMeta.classList.add("hidden");
      elements.rootMeta.textContent = "";
      return;
    }

    const permission = await queryRootPermission(rootHandle);
    const isGranted = permission === "granted";
    const sentinel = isGranted ? await ensureRootSentinel(rootHandle) : null;

    elements.rootStatus.className = isGranted ? "success-box" : "error-box";
    elements.rootStatus.textContent = isGranted
      ? "Root directory is ready for read/write access."
      : "Root directory exists but Chrome needs access to be reauthorized.";

    elements.rootMeta.classList.remove("hidden");
    elements.rootMeta.textContent = JSON.stringify({ permission, sentinel }, null, 2);
  }

  async function renderNativeConfig(): Promise<void> {
    const nativeConfig = await getNativeHostConfig();
    elements.nativeHostNameInput.value = nativeConfig.hostName;
    elements.nativeCommandTemplateInput.value = nativeConfig.commandTemplate;
    elements.nativeRootPathInput.value = nativeConfig.rootPath;

    const chunks: string[] = [];
    if (nativeConfig.verifiedAt) {
      chunks.push(`Last verified: ${nativeConfig.verifiedAt}`);
    }
    if (nativeConfig.lastVerificationError) {
      chunks.push(`Verification error: ${nativeConfig.lastVerificationError}`);
    }
    if (nativeConfig.lastOpenError) {
      chunks.push(`Open error: ${nativeConfig.lastOpenError}`);
    }

    elements.nativeStatus.className = chunks.some((value) => value.toLowerCase().includes("error")) ? "error-box" : "muted-box";
    elements.nativeStatus.textContent = chunks.length ? chunks.join(" | ") : "No helper verification has run yet.";
  }

  async function addSite(originInput: string): Promise<void> {
    const origin = normalizeSiteInput(originInput);
    const sites = await getSiteConfigs();
    if (sites.some((site) => site.origin === origin)) {
      return;
    }

    const permissionPattern = originToPermissionPattern(origin);
    const granted = await chromeApi.permissions.request({ origins: [permissionPattern] });

    if (!granted) {
      throw new Error(`Host access was not granted for ${permissionPattern}.`);
    }

    const nextSites = [...sites, createSiteConfig(origin)];
    nextSites.sort((left, right) => left.origin.localeCompare(right.origin));
    await setSiteConfigs(nextSites);
  }

  async function updateSite(origin: string, patch: Pick<SiteConfig, "mode" | "dumpAllowlistPatterns">): Promise<void> {
    if (!isValidDumpAllowlistPatterns(patch.dumpAllowlistPatterns)) {
      throw new Error("One or more dump allowlist patterns are invalid.");
    }

    const sites = await getSiteConfigs();
    const nextSites = sites.map((site) => (
      site.origin === origin
        ? {
            ...site,
            mode: patch.mode,
            dumpAllowlistPatterns: patch.dumpAllowlistPatterns
          }
        : site
    ));
    await setSiteConfigs(nextSites);
    await renderSites();
  }

  async function removeSite(origin: string): Promise<void> {
    const permissionPattern = originToPermissionPattern(origin);
    await chromeApi.permissions.remove({ origins: [permissionPattern] });
    const sites = await getSiteConfigs();
    await setSiteConfigs(sites.filter((site) => site.origin !== origin));
    await renderSites();
    setFlash(elements, "success", `Removed ${origin}.`);
  }

  elements.siteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFlash(elements, null, "");

    try {
      await addSite(elements.siteOriginInput.value);
      elements.siteOriginInput.value = "";
      await renderSites();
      setFlash(elements, "success", "Origin added and host access granted.");
    } catch (error) {
      setFlash(elements, "error", error instanceof Error ? error.message : String(error));
    }
  });

  elements.chooseRootButton.addEventListener("click", async () => {
    setFlash(elements, null, "");
    try {
      const rootHandle = await windowRef.showDirectoryPicker({ mode: "readwrite" });
      const sentinel = await storeRootHandleWithSentinel(rootHandle);
      await renderRootState();
      setFlash(elements, "success", `Root directory saved. Root ID: ${sentinel.rootId}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setFlash(elements, "error", error instanceof Error ? error.message : String(error));
    }
  });

  elements.reauthorizeRootButton.addEventListener("click", async () => {
    setFlash(elements, null, "");
    try {
      const rootHandle = await loadStoredRootHandle();
      if (!rootHandle) {
        throw new Error("Choose a root directory first.");
      }
      const permission = await requestRootPermission(rootHandle);
      await renderRootState();
      setFlash(elements, permission === "granted" ? "success" : "error", `Root permission status: ${permission}`);
    } catch (error) {
      setFlash(elements, "error", error instanceof Error ? error.message : String(error));
    }
  });

  elements.nativeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFlash(elements, null, "");

    const nextConfig: NativeHostConfig = {
      ...(await getNativeHostConfig()),
      hostName: elements.nativeHostNameInput.value.trim(),
      rootPath: elements.nativeRootPathInput.value.trim(),
      commandTemplate: elements.nativeCommandTemplateInput.value.trim()
    };

    await setNativeHostConfig(nextConfig);
    await renderNativeConfig();
    setFlash(elements, "success", "Native helper settings saved.");
  });

  elements.verifyHelperButton.addEventListener("click", async () => {
    setFlash(elements, null, "");
    try {
      const result = await chromeApi.runtime.sendMessage({ type: "native.verify" }) as NativeVerifyResult;
      await renderNativeConfig();
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult) || "Native helper verification failed.");
      }
      setFlash(elements, "success", `Helper verified at ${result.verifiedAt}.`);
    } catch (error) {
      setFlash(elements, "error", error instanceof Error ? error.message : String(error));
    }
  });

  await Promise.all([renderSites(), renderRootState(), renderNativeConfig()]);

  return {
    elements,
    renderSites,
    renderRootState,
    renderNativeConfig,
    addSite,
    removeSite,
    updateSite
  };
}

if (!isTestMode()) {
  void initOptions();
}

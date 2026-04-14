interface Window {
  showDirectoryPicker(options?: {
    mode?: "read" | "readwrite";
  }): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
  queryPermission?(options?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(options?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
}

interface GlobalThis {
  __CHROME_QA_TEST__?: boolean;
}

export interface Output {
  banner(): void;
  success(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  heading(message: string): void;
  keyValue(key: string, value: string | number): void;
  info(message: string): void;
  listItem(item: string): void;
  block(content: string): void;
  usage(message: string): void;
}

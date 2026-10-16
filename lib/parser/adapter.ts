import type { FileRecord } from "./types";

export type ParserAdapter = {
  name: string;
  isEntryPoint(filePath: string): boolean;
  shouldInclude(filePath: string): boolean;
  moduleName(filePath: string): string;
};

export const fallbackAdapter: ParserAdapter = {
  name: "fallback",
  isEntryPoint: (filePath) => /(^|[\\/])(index|main|src)[^\\/]*\.(?:c|m)?[jt]sx?$/.test(filePath),
  shouldInclude: (filePath) => /\.(?:c|m)?[jt]sx?$/.test(filePath),
  moduleName: (filePath) => filePath.replace(/\.(?:c|m)?[jt]sx?$/, ""),
};

export function moduleForFile(file: FileRecord): string {
  return file.module;
}

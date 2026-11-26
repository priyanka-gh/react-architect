import type { Manifest } from "../manifest/schema";
import type { NameForms } from "../naming";
import type { FileOperation } from "../plan";

export type GeneratorId = "component" | "hook" | "feature";

export interface GenerateInput {
  name: NameForms;
  /** Folder to generate into, relative to the project folder (where the manifest is). */
  directory: string;
  /** Ignored when the manifest's test framework is "none". */
  includeTests: boolean;
  /** Add an export to the enclosing feature's index.ts (ADR 6). */
  exportFromFeature: boolean;
}

export interface GeneratedFiles {
  operations: FileOperation[];
  /** The file to open once everything is written. */
  mainFile: string;
}

export interface Generator {
  id: GeneratorId;
  /** "Component", "Hook", "Feature". */
  label: string;
  /** Example shown in the name prompt. */
  namePlaceholder: string;
  /** How the result is referred to in messages, e.g. "UserCard" or "useCart". */
  displayName(name: NameForms): string;
  /** Where to generate when the user didn't pick a folder. */
  defaultDirectory(manifest: Manifest): string;
  /**
   * Other suitable folders, when the structure has several (such as each
   * unit layer for features). The user is asked when there's more than one.
   */
  directoryChoices?(manifest: Manifest): string[];
  /** Whether output generated inside a feature can be exported from its index.ts. */
  canExportFromFeature: boolean;
  generate(input: GenerateInput, manifest: Manifest): GeneratedFiles;
}

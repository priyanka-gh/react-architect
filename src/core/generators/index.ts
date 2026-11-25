import { componentGenerator } from "./component";
import { featureGenerator } from "./feature";
import { hookGenerator } from "./hook";
import type { Generator, GeneratorId } from "./types";

export type {
  GenerateInput,
  GeneratedFiles,
  Generator,
  GeneratorId,
} from "./types";

/** Every generator. Adding one means adding a file and an entry here (ADR 8). */
export const GENERATORS: readonly Generator[] = [
  componentGenerator,
  hookGenerator,
  featureGenerator,
];

export function getGenerator(id: GeneratorId): Generator {
  const generator = GENERATORS.find((candidate) => candidate.id === id);
  if (generator === undefined) {
    throw new Error(`Unknown generator "${id}".`);
  }
  return generator;
}

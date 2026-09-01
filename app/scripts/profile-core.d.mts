export interface ProfileDataParser {
  readonly parsePureDataPatches: (patchSource: string) => readonly unknown[]
  readonly profilePackageNames: (patchSource: string) => readonly string[]
}

export declare function createProfileDataParser(
  parseYaml: (source: string) => unknown,
): ProfileDataParser

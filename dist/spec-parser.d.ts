import { SpecTree } from './types';
/**
 * Parse a complete file and return its SpecTree.
 */
export declare function parseFile(filePath: string): SpecTree;
/**
 * Parse source code string and return its SpecTree.
 */
export declare function parseSource(source: string, fileName: string): SpecTree;
/**
 * Parse all .ts files in a directory recursively.
 */
export declare function parseDirectory(dirPath: string): SpecTree;
/**
 * Parse a file or directory.
 */
export declare function parsePath(targetPath: string): SpecTree;
//# sourceMappingURL=spec-parser.d.ts.map
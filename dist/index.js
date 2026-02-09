"use strict";
// ============================================================================
// opspec — OPNet Specification Language & Verifier
// ============================================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeCoverageFromFile = exports.computeCoverage = exports.generateAnnotatedSource = exports.formatTemplatesAsJson = exports.formatTemplatesAsAnnotations = exports.generateTemplates = exports.formatCoverage = exports.formatReportsJson = exports.formatReports = exports.formatReport = exports.verifyFile = exports.verifyContract = exports.parsePath = exports.parseDirectory = exports.parseSource = exports.parseFile = void 0;
__exportStar(require("./types"), exports);
var spec_parser_1 = require("./spec-parser");
Object.defineProperty(exports, "parseFile", { enumerable: true, get: function () { return spec_parser_1.parseFile; } });
Object.defineProperty(exports, "parseSource", { enumerable: true, get: function () { return spec_parser_1.parseSource; } });
Object.defineProperty(exports, "parseDirectory", { enumerable: true, get: function () { return spec_parser_1.parseDirectory; } });
Object.defineProperty(exports, "parsePath", { enumerable: true, get: function () { return spec_parser_1.parsePath; } });
var verifier_1 = require("./verifier");
Object.defineProperty(exports, "verifyContract", { enumerable: true, get: function () { return verifier_1.verifyContract; } });
Object.defineProperty(exports, "verifyFile", { enumerable: true, get: function () { return verifier_1.verifyFile; } });
var reporter_1 = require("./reporter");
Object.defineProperty(exports, "formatReport", { enumerable: true, get: function () { return reporter_1.formatReport; } });
Object.defineProperty(exports, "formatReports", { enumerable: true, get: function () { return reporter_1.formatReports; } });
Object.defineProperty(exports, "formatReportsJson", { enumerable: true, get: function () { return reporter_1.formatReportsJson; } });
Object.defineProperty(exports, "formatCoverage", { enumerable: true, get: function () { return reporter_1.formatCoverage; } });
var template_generator_1 = require("./template-generator");
Object.defineProperty(exports, "generateTemplates", { enumerable: true, get: function () { return template_generator_1.generateTemplates; } });
Object.defineProperty(exports, "formatTemplatesAsAnnotations", { enumerable: true, get: function () { return template_generator_1.formatTemplatesAsAnnotations; } });
Object.defineProperty(exports, "formatTemplatesAsJson", { enumerable: true, get: function () { return template_generator_1.formatTemplatesAsJson; } });
Object.defineProperty(exports, "generateAnnotatedSource", { enumerable: true, get: function () { return template_generator_1.generateAnnotatedSource; } });
var coverage_1 = require("./coverage");
Object.defineProperty(exports, "computeCoverage", { enumerable: true, get: function () { return coverage_1.computeCoverage; } });
Object.defineProperty(exports, "computeCoverageFromFile", { enumerable: true, get: function () { return coverage_1.computeCoverageFromFile; } });
//# sourceMappingURL=index.js.map
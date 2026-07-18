"use strict";
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const init_1 = require("./init");
const stateUtils = __importStar(require("../utils/state"));
// Mock fs and state modules
vitest_1.vi.mock('fs');
vitest_1.vi.mock('../utils/state');
(0, vitest_1.describe)('initRepository', () => {
    const targetDir = '/mock/dir';
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.resetAllMocks();
    });
    (0, vitest_1.it)('should not initialize if mcv.yaml already exists', () => {
        // Mock fs.existsSync to return true
        vitest_1.vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        const consoleSpy = vitest_1.vi.spyOn(console, 'log').mockImplementation(() => { });
        (0, init_1.initRepository)(targetDir);
        (0, vitest_1.expect)(fs.existsSync).toHaveBeenCalledWith(path.join(targetDir, 'mcv.yaml'));
        (0, vitest_1.expect)(fs.writeFileSync).not.toHaveBeenCalled();
        (0, vitest_1.expect)(consoleSpy).toHaveBeenCalledWith('An mcv.yaml manifest already exists in this directory.');
        consoleSpy.mockRestore();
    });
    (0, vitest_1.it)('should initialize repository, create mcv.yaml and update state', () => {
        vitest_1.vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        const mockState = {};
        vitest_1.vi.spyOn(stateUtils, 'readState').mockReturnValue(mockState);
        const writeStateSpy = vitest_1.vi.spyOn(stateUtils, 'writeState').mockImplementation(() => { });
        const consoleSpy = vitest_1.vi.spyOn(console, 'log').mockImplementation(() => { });
        (0, init_1.initRepository)(targetDir);
        // Verify fs.writeFileSync was called with the correct path and yaml content
        (0, vitest_1.expect)(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const [writtenPath, writtenContent] = vitest_1.vi.mocked(fs.writeFileSync).mock.calls[0];
        (0, vitest_1.expect)(writtenPath).toBe(path.join(targetDir, 'mcv.yaml'));
        (0, vitest_1.expect)(writtenContent).toContain('schemaVersion: 1');
        (0, vitest_1.expect)(writtenContent).toContain('id: ');
        (0, vitest_1.expect)(writtenContent).toContain('initializedAt: ');
        // Verify state was updated and saved
        (0, vitest_1.expect)(stateUtils.readState).toHaveBeenCalled();
        (0, vitest_1.expect)(writeStateSpy).toHaveBeenCalledTimes(1);
        const writtenState = writeStateSpy.mock.calls[0][0];
        (0, vitest_1.expect)(writtenState.defaultRepository).toBeDefined();
        (0, vitest_1.expect)(writtenState.defaultRepository?.path).toBe(targetDir);
        (0, vitest_1.expect)(writtenState.defaultRepository?.id).toBeTruthy();
        consoleSpy.mockRestore();
    });
});

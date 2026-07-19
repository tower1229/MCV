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
exports.showStatus = showStatus;
const fs = __importStar(require("fs"));
const files_1 = require("../utils/files");
const state_1 = require("../utils/state");
function showStatus() {
    const baseline = (0, state_1.readState)().baselineSnapshot;
    if (!baseline || Object.keys(baseline.files).length === 0) {
        console.log('No deployment baseline found. Run `mcv deploy` first.');
        return;
    }
    for (const [filePath, expectedHash] of Object.entries(baseline.files)) {
        if (!fs.existsSync(filePath)) {
            console.log(`[missing] ${filePath}`);
            continue;
        }
        const currentHash = (0, files_1.hashFile)(filePath);
        console.log(`[${currentHash === expectedHash ? 'matching' : 'drifted'}] ${filePath}`);
    }
}

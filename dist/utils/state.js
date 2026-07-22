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
exports.getStateFilePath = getStateFilePath;
exports.readState = readState;
exports.writeState = writeState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function getStateFilePath(context) {
    if (context.platform === 'win32') {
        return path.join(context.env.APPDATA || path.join(context.homeDir, 'AppData', 'Roaming'), 'mcv', 'config.json');
    }
    if (context.platform === 'darwin') {
        return path.join(context.homeDir, 'Library', 'Application Support', 'mcv', 'config.json');
    }
    return path.join(context.homeDir, '.config', 'mcv', 'config.json');
}
function readState(context) {
    const statePath = getStateFilePath(context);
    if (fs.existsSync(statePath)) {
        try {
            const content = fs.readFileSync(statePath, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return {};
        }
    }
    return {};
}
function writeState(context, state) {
    const statePath = getStateFilePath(context);
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}
